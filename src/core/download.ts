import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { USER_AGENT } from '../config.js';
import { ApiError, type SoundCloud } from './api.js';
import { debug } from './debug.js';
import { detectExt } from './filter.js';
import type { Library } from './library.js';
import type { Candidate, ScUser } from './types.js';
import { Speedometer, abortError, isAbort } from './util.js';

export interface CurrentFile {
  title: string;
  uploader: string;
  ext: string;
  size?: number;
  bytes: number;
}

export interface DownloadStats {
  total: number;
  done: number;
  ok: number;
  fail: number;
  already: number;
  unauthorized: number;
  bytesDone: number;
  /** Sum of known sizes; null when at least one size is unknown. */
  bytesTotal: number | null;
  speed: number;
  eta: number | null;
  current: CurrentFile | null;
  failures: string[];
  startedAt: number;
  finishedAt?: number;
}

export interface DownloadOptions {
  signal: AbortSignal;
  /** Receives the live stats object as soon as it exists (the TUI reads it while downloading). */
  onStats?: (stats: DownloadStats) => void;
}

/** Sequential downloads of the selection with per-file progress, dedup via the index (spec §2.4, §3D). */
export async function downloadSelection(
  api: SoundCloud,
  library: Library,
  curator: ScUser,
  items: Candidate[],
  opts: DownloadOptions,
): Promise<DownloadStats> {
  const allSizesKnown = items.every((i) => i.size);
  const stats: DownloadStats = {
    total: items.length,
    done: 0,
    ok: 0,
    fail: 0,
    already: 0,
    unauthorized: 0,
    bytesDone: 0,
    bytesTotal: allSizesKnown ? items.reduce((n, i) => n + (i.size ?? 0), 0) : null,
    speed: 0,
    eta: null,
    current: null,
    failures: [],
    startedAt: Date.now(),
  };
  const speedometer = new Speedometer();
  opts.onStats?.(stats);

  for (const item of items) {
    if (opts.signal.aborted) throw abortError();
    try {
      if ((await library.check(item.id)) === 'have') {
        stats.already++;
        if (stats.bytesTotal !== null) stats.bytesTotal -= item.size ?? 0;
        continue;
      }
      await downloadOne(api, library, curator, item, stats, speedometer, opts.signal);
      stats.ok++;
    } catch (err) {
      if (isAbort(err) || opts.signal.aborted) throw abortError();
      if (err instanceof ApiError && err.status === 401) stats.unauthorized++;
      else {
        stats.fail++;
        stats.failures.push(`${item.uploaderName} — ${item.title}: ${err instanceof Error ? err.message : String(err)}`);
      }
      debug('download failed', item.id, String(err));
    } finally {
      stats.done++;
      stats.current = null;
      stats.eta = estimateEta(stats);
    }
  }
  stats.finishedAt = Date.now();
  return stats;
}

async function downloadOne(
  api: SoundCloud,
  library: Library,
  curator: ScUser,
  item: Candidate,
  stats: DownloadStats,
  speedometer: Speedometer,
  signal: AbortSignal,
): Promise<void> {
  // Reuse the link obtained during the scan; refresh it if the CDN says it expired.
  let url = item.url ?? (await api.downloadUrl(item.id));
  let res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal });
  if (res.status === 403 && item.url) {
    url = await api.downloadUrl(item.id);
    res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal });
  }
  if (res.status === 401) throw new ApiError(401, 'login required');
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  // The original file is kept as served — no re-encoding. Unknown format falls back to mp3, like yt-dlp.
  const ext =
    detectExt({ contentDisposition: res.headers.get('content-disposition'), contentType: res.headers.get('content-type'), url: res.url || url }) ??
    item.ext ??
    'mp3';
  const size = Number(res.headers.get('content-length')) || item.size;
  const target = library.target(item.uploaderName, item.title, item.id, ext);
  const part = `${target.abs}.part`;
  const current: CurrentFile = { title: item.title, uploader: item.uploaderName, ext, size, bytes: 0 };
  stats.current = current;

  await fsp.mkdir(path.dirname(target.abs), { recursive: true });
  try {
    await streamToFile(res.body, part, (n) => {
      current.bytes += n;
      stats.bytesDone += n;
      speedometer.add(stats.bytesDone);
      stats.speed = speedometer.bytesPerSec;
      stats.eta = estimateEta(stats);
    });
    await fsp.rename(part, target.abs);
  } catch (err) {
    await fsp.rm(part, { force: true }); // never leave a half file behind (spec §3D)
    throw err;
  }
  await library.record({
    id: String(item.id),
    path: target.rel,
    title: item.title,
    curator: curator.permalink,
    uploader: item.uploader,
    downloaded_at: new Date().toISOString(),
  });
}

async function streamToFile(body: ReadableStream<Uint8Array>, file: string, onChunk: (n: number) => void): Promise<void> {
  const out = fs.createWriteStream(file);
  try {
    for await (const chunk of body) {
      if (!out.write(chunk)) await once(out, 'drain');
      onChunk(chunk.byteLength);
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    throw err;
  }
}

function estimateEta(stats: DownloadStats): number | null {
  const elapsed = Date.now() - stats.startedAt;
  if (stats.bytesTotal !== null && stats.bytesDone > 0) {
    const avg = stats.bytesDone / (elapsed / 1000);
    return avg > 0 ? ((stats.bytesTotal - stats.bytesDone) / avg) * 1000 : null;
  }
  if (stats.done === 0) return null;
  return (elapsed / stats.done) * (stats.total - stats.done);
}
