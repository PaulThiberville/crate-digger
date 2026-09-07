import path from 'node:path';
import { LOSSLESS } from '../config.js';
import type { Quality, ScTrack, SkipReason } from './types.js';

/** Spec §2.2: only official free downloads, public, short enough. Returns the skip reason or null when eligible. */
export function eligibility(track: ScTrack, maxMs: number): SkipReason | null {
  if (track.downloadable !== true) return 'not_downloadable';
  if (track.has_downloads_left !== true) return 'no_downloads_left';
  if (track.sharing !== 'public' || track.streamable === false) return 'not_public';
  if (typeof track.duration !== 'number' || track.duration > maxMs) return 'too_long';
  return null;
}

/** Spec §2.3: lossless original → HIGH, any other known format → LOW, unknown → UNKNOWN. */
export function classify(ext: string | undefined): Quality {
  if (!ext) return 'UNKNOWN';
  return LOSSLESS.has(ext.toLowerCase()) ? 'HIGH' : 'LOW';
}

const MIME_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/x-ms-wma': 'wma',
};

export interface ExtHints {
  contentDisposition?: string | null;
  contentType?: string | null;
  url?: string | null;
}

/** Original file extension, best source first: Content-Disposition, then the URL, then the MIME type. */
export function detectExt(hints: ExtHints): string | undefined {
  return extFromDisposition(hints.contentDisposition) ?? extFromUrl(hints.url) ?? extFromType(hints.contentType);
}

function extFromDisposition(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*[\w-]*'[\w-]*'([^;]+)/i.exec(header);
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  let name = star?.[1] ?? plain?.[1] ?? plain?.[2];
  if (!name) return undefined;
  try {
    name = decodeURIComponent(name.trim());
  } catch {
    name = name.trim();
  }
  return cleanExt(path.posix.extname(name));
}

function extFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return extFromDisposition(u.searchParams.get('response-content-disposition')) ?? cleanExt(path.posix.extname(u.pathname));
  } catch {
    return undefined;
  }
}

function extFromType(contentType: string | null | undefined): string | undefined {
  if (!contentType) return undefined;
  const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_EXT[mime];
}

function cleanExt(ext: string): string | undefined {
  const e = ext.replace(/^\./, '').toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(e) ? e : undefined;
}
