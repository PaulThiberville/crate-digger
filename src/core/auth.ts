import fsp from 'node:fs/promises';
import { CONFIG_DIR, SESSION_FILE } from '../config.js';
import { ApiError, type SoundCloud } from './api.js';
import type { Browser } from './browser.js';
import type { ScUser, Session } from './types.js';
import { sleep } from './util.js';

export async function loadSession(): Promise<Session | null> {
  try {
    const s = JSON.parse(await fsp.readFile(SESSION_FILE, 'utf8')) as Session;
    return typeof s?.token === 'string' && s.token ? s : null;
  } catch {
    return null;
  }
}

/** User-only file, outside the repo (spec §5.2). */
export async function saveSession(session: Session): Promise<void> {
  await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fsp.writeFile(SESSION_FILE, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

export async function clearSession(): Promise<boolean> {
  try {
    await fsp.rm(SESSION_FILE);
    return true;
  } catch {
    return false;
  }
}

/** Is this token still accepted? The account when yes, null when SoundCloud rejects it. */
export async function verifyToken(api: SoundCloud, token: string): Promise<ScUser | null> {
  const previous = api.token;
  api.token = token;
  try {
    const me = await api.me();
    return me?.id ? me : null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  } finally {
    api.token = previous;
  }
}

/** Poll the browser until the SoundCloud web app has set its oauth_token cookie (the user logged in). */
export async function waitForLogin(browser: Browser, opts: { timeoutMs: number; signal: AbortSignal }): Promise<string | null> {
  const deadline = Date.now() + opts.timeoutMs;
  let closed = false;
  void browser.closed.then(() => (closed = true));
  while (!opts.signal.aborted && !closed && Date.now() < deadline) {
    const token = await browser.cookie('oauth_token').catch(() => null);
    if (token) return token;
    await sleep(1000);
  }
  return null;
}
