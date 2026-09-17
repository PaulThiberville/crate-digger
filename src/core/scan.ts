import { SCAN_CONCURRENCY, USER_AGENT } from '../config.js';
import { ApiError, type SoundCloud } from './api.js';
import { debug } from './debug.js';
import { classify, detectExt, eligibility } from './filter.js';
import type { Candidate, ScTrack, ScUser, SkipReason, Source } from './types.js';
import { abortError, runPool } from './util.js';

export interface ScanStats {
  source: Source;
  /** Progress unit: followings visited (followings mode) or liked tracks inspected (likes mode). */
  total: number;
  done: number;
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

type Uploader = Pick<ScUser, 'permalink' | 'username'>;

/** Dispatch on the mode: both strategies feed the same eligibility → probe → tally pipeline. */
export function scan(api: SoundCloud, source: Source, opts: ScanOptions): Promise<ScanResult> {
  return source.mode === 'likes' ? scanLikes(api, source, opts) : scanFollowings(api, source, opts);
}

/** Curator → every account they follow → every track those accounts published (spec §2.1). */
export async function scanFollowings(api: SoundCloud, source: Source, opts: ScanOptions): Promise<ScanResult> {
  const run = start(api, source, source.profile.followings_count ?? 0, opts);
  const { stats } = run;
  stats.current = 'listing followings…';

  const followings: ScUser[] = [];
  for await (const user of api.followings(source.profile.id)) {
    if (opts.signal.aborted) throw abortError();
    followings.push(user);
    stats.total = Math.max(stats.total, followings.length);
  }
  stats.total = followings.length;

  await runPool(followings, SCAN_CONCURRENCY, async (user) => {
    try {
      for await (const track of api.tracks(user.id)) {
        if (opts.signal.aborted) return;
        await run.inspect(track, user);
      }
    } catch (err) {
      if (!opts.signal.aborted) {
        stats.errors++;
        debug('following failed', user.permalink, String(err));
      }
    } finally {
      stats.done++;
    }
  });
  return run.finish();
}

/** Profile → every track they liked, whoever published it. Liked playlists are ignored. */
export async function scanLikes(api: SoundCloud, source: Source, opts: ScanOptions): Promise<ScanResult> {
  const run = start(api, source, source.profile.likes_count ?? 0, opts);
  const { stats } = run;
  stats.current = 'listing likes…';

  const liked: ScTrack[] = [];
  const seen = new Set<number>();
  for await (const track of api.likes(source.profile.id)) {
    if (opts.signal.aborted) throw abortError();
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    liked.push(track);
    stats.total = Math.max(stats.total, liked.length);
    stats.current = `listing likes… ${liked.length}`;
  }
  stats.total = liked.length; // likes_count also counts playlists: the listing is the truth

  await runPool(liked, SCAN_CONCURRENCY, async (track) => {
    if (opts.signal.aborted) return;
    try {
      await run.inspect(track, uploaderOf(track));
    } catch (err) {
      if (!opts.signal.aborted) {
        stats.errors++;
        debug('like failed', track.id, String(err));
      }
    } finally {
      stats.done++;
    }
  });
  return run.finish();
}

function uploaderOf(track: ScTrack): Uploader {
  return { permalink: track.user?.permalink ?? 'unknown', username: track.user?.username ?? 'Unknown' };
}

/** The part shared by every mode: live stats, the eligibility → probe → tally step, and the wrap-up. */
function start(api: SoundCloud, source: Source, total: number, opts: ScanOptions) {
  const stats: ScanStats = {
    source,
    total,
    done: 0,
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
    current: 'starting…',
    startedAt: Date.now(),
  };
  const candidates: Candidate[] = [];
  opts.onStats?.(stats);

  const inspect = async (track: ScTrack, uploader: Uploader): Promise<void> => {
    stats.tracksSeen++;
    stats.current = `${uploader.username} — ${track.title}`;
    const reason = eligibility(track, opts.maxMs);
    if (reason) {
      stats.skipped[reason]++;
      return;
    }
    const candidate: Candidate = {
      id: track.id,
      title: track.title,
      uploader: uploader.permalink,
      uploaderName: uploader.username,
      duration: track.duration,
      quality: 'UNKNOWN',
    };
    if (opts.probe) {
      if ((await probe(api, candidate, stats)) === 'forbidden') {
        stats.skipped.forbidden++;
        return;
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
  };

  const finish = (): ScanResult => {
    if (opts.signal.aborted) throw abortError();
    stats.current = 'done';
    stats.finishedAt = Date.now();
    return { stats, candidates };
  };

  return { stats, candidates, inspect, finish };
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
