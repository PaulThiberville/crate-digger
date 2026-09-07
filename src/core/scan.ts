import { SCAN_CONCURRENCY, USER_AGENT } from '../config.js';
import { ApiError, type SoundCloud } from './api.js';
import { debug } from './debug.js';
import { classify, detectExt, eligibility } from './filter.js';
import type { Candidate, ScUser, SkipReason } from './types.js';
import { abortError, runPool } from './util.js';

export interface ScanStats {
  curator: ScUser;
  followingsTotal: number;
  followingsDone: number;
  tracksSeen: number;
  eligible: number;
  high: number;
  low: number;
  unknown: number;
  loginRequired: number;
  skipped: Record<SkipReason, number>;
  errors: number;
  bytes: number; // known sizes of eligible tracks
  sizeUnknown: number; // eligible tracks whose size is unknown
  current: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ScanOptions {
  maxMs: number;
  /** Ask SoundCloud for the original file link of each eligible track (needs a login) to learn format + size. */
  probe: boolean;
  signal: AbortSignal;
  /** Receives the live stats object as soon as it exists (the TUI reads it while scanning). */
  onStats?: (stats: ScanStats) => void;
}

export interface ScanResult {
  stats: ScanStats;
  candidates: Candidate[];
}

/** Curator → every account they follow → every track those accounts published (spec §2.1). */
export async function scanCurator(api: SoundCloud, curator: ScUser, opts: ScanOptions): Promise<ScanResult> {
  const stats: ScanStats = {
    curator,
    followingsTotal: curator.followings_count ?? 0,
    followingsDone: 0,
    tracksSeen: 0,
    eligible: 0,
    high: 0,
    low: 0,
    unknown: 0,
    loginRequired: 0,
    skipped: { not_downloadable: 0, no_downloads_left: 0, not_public: 0, too_long: 0, forbidden: 0 },
    errors: 0,
    bytes: 0,
    sizeUnknown: 0,
    current: 'listing followings…',
    startedAt: Date.now(),
  };
  const candidates: Candidate[] = [];
  opts.onStats?.(stats);

  const followings: ScUser[] = [];
  for await (const user of api.followings(curator.id)) {
    if (opts.signal.aborted) throw abortError();
    followings.push(user);
    stats.followingsTotal = Math.max(stats.followingsTotal, followings.length);
  }
  stats.followingsTotal = followings.length;

  await runPool(followings, SCAN_CONCURRENCY, async (user) => {
    try {
      for await (const track of api.tracks(user.id)) {
        if (opts.signal.aborted) return;
        stats.tracksSeen++;
        stats.current = `${user.username} — ${track.title}`;
        const reason = eligibility(track, opts.maxMs);
        if (reason) {
          stats.skipped[reason]++;
          continue;
        }
        const candidate: Candidate = {
          id: track.id,
          title: track.title,
          uploader: user.permalink,
          uploaderName: user.username,
          duration: track.duration,
          quality: 'UNKNOWN',
        };
        if (opts.probe) {
          if ((await probe(api, candidate, stats)) === 'forbidden') {
            stats.skipped.forbidden++;
            continue;
          }
        } else {
          candidate.loginRequired = true;
          stats.loginRequired++;
        }
        candidates.push(candidate);
        stats.eligible++;
        if (candidate.quality === 'HIGH') stats.high++;
        else if (candidate.quality === 'LOW') stats.low++;
        else stats.unknown++;
        if (candidate.size) stats.bytes += candidate.size;
        else stats.sizeUnknown++;
      }
    } catch (err) {
      if (!opts.signal.aborted) {
        stats.errors++;
        debug('following failed', user.permalink, String(err));
      }
    } finally {
      stats.followingsDone++;
    }
  });

  if (opts.signal.aborted) throw abortError();
  stats.current = 'done';
  stats.finishedAt = Date.now();
  return { stats, candidates };
}

/** Learn the original format and size from the official download link (the only place they are exposed). */
async function probe(api: SoundCloud, c: Candidate, stats: ScanStats): Promise<'ok' | 'forbidden'> {
  try {
    const url = await api.downloadUrl(c.id);
    c.url = url;
    c.urlAt = Date.now();
    const head = await headInfo(url);
    c.ext = head.ext;
    c.size = head.size;
    c.quality = classify(c.ext);
    return 'ok';
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      c.loginRequired = true;
      stats.loginRequired++;
    } else if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return 'forbidden';
    } else {
      stats.errors++; // keep it as UNKNOWN; the download phase gets a fresh link anyway
      debug('probe failed', c.id, String(err));
    }
    return 'ok';
  }
}

async function headInfo(url: string): Promise<{ ext?: string; size?: number }> {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return { ext: detectExt({ url }) };
    return {
      ext: detectExt({ contentDisposition: res.headers.get('content-disposition'), contentType: res.headers.get('content-type'), url: res.url || url }),
      size: Number(res.headers.get('content-length')) || undefined,
    };
  } catch {
    return { ext: detectExt({ url }) };
  }
}
