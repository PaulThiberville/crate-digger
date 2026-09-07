import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config.js';

/** Opt-in file log (CRATE_DEBUG=1 → ~/.config/crate/debug.log). Never receives tokens. */
const enabled = process.env.CRATE_DEBUG === '1';
let stream: fs.WriteStream | undefined;

export function debug(...parts: unknown[]): void {
  if (!enabled) return;
  if (!stream) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    stream = fs.createWriteStream(path.join(CONFIG_DIR, 'debug.log'), { flags: 'a' });
  }
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  stream.write(`${new Date().toISOString()} ${line}\n`);
}
