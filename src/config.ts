import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'CRATE DIGGER';
export const CMD = 'crate';
export const VERSION = '0.1.0';
export const TAGLINE = 'official free downloads only · curator graph · no stream rips';

const env = process.env;

/** SoundCloud endpoints. Overridable only to point at the offline mock (scripts/mock-soundcloud.mjs). */
export const WEB_BASE = (env.CRATE_WEB_BASE ?? 'https://soundcloud.com').replace(/\/+$/, '');
export const API_BASE = (env.CRATE_API_BASE ?? 'https://api-v2.soundcloud.com').replace(/\/+$/, '');
export const WEB_HOST = new URL(WEB_BASE).hostname;

/** Local state (session token, cached client_id, browser profile). Lives outside the repo, user-only. */
export const CONFIG_DIR = env.CRATE_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'crate');
export const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');
export const CLIENT_ID_FILE = path.join(CONFIG_DIR, 'client_id.json');
export const BROWSER_PROFILE_DIR = path.join(CONFIG_DIR, 'browser');

/** Fixed destination (spec §4): ~/Documents/Music/Crate Digger, created on demand. */
export const LIBRARY_DIR = env.CRATE_LIBRARY_DIR ?? path.join(os.homedir(), 'Documents', 'Music', 'Crate Digger');
export const INDEX_FILE = path.join(LIBRARY_DIR, 'index.json');

export const DEFAULT_MAX_MINUTES = 12;
export const LOSSLESS = new Set(['wav', 'aiff', 'aif', 'flac', 'alac']);
/** Max page size for linked_partitioning queries (SoundCloud caps it at 200). */
export const PAGE_LIMIT = 200;
export const SCAN_CONCURRENCY = 4;
export const LOGIN_TIMEOUT_MS = 5 * 60_000;
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
