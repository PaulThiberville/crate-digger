import fsp from 'node:fs/promises';
import { CLIENT_ID_FILE, CONFIG_DIR, WEB_BASE } from '../config.js';
import { debug } from './debug.js';
import { directTransport, type Transport } from './http.js';

const RE_CLIENT_ID = /client_id\s*:\s*"([0-9a-zA-Z]{32})"/;

export async function loadClientId(): Promise<string | null> {
  try {
    const { client_id } = JSON.parse(await fsp.readFile(CLIENT_ID_FILE, 'utf8')) as { client_id?: unknown };
    return typeof client_id === 'string' && client_id ? client_id : null;
  } catch {
    return null;
  }
}

export async function saveClientId(client_id: string): Promise<void> {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(CLIENT_ID_FILE, JSON.stringify({ client_id, saved_at: new Date().toISOString() }));
}

/** Same technique as yt-dlp: the public web client embeds its client_id in one of its JS bundles. */
export async function scrapeClientId(transport: Transport = directTransport): Promise<string | null> {
  try {
    const home = await transport(`${WEB_BASE}/`, { accept: 'text/html' });
    if (home.status !== 200) {
      debug('client_id scrape: home page status', home.status);
      return null;
    }
    const scripts = [...home.body.matchAll(/<script[^>]+src="(https?:\/\/[^"]+\.js)"/g)].map((m) => m[1] as string).reverse();
    for (const src of scripts) {
      const hit = RE_CLIENT_ID.exec((await transport(src, { accept: '*/*' })).body);
      if (hit) return hit[1] as string;
    }
  } catch (err) {
    debug('client_id scrape failed', String(err));
  }
  return null;
}
