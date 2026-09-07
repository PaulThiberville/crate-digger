import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_PROFILE_DIR, WEB_BASE, WEB_HOST } from '../config.js';
import { debug } from './debug.js';
import type { HttpResponse } from './http.js';
import { sleep } from './util.js';

const MAC_APPS = [
  'Google Chrome.app/Contents/MacOS/Google Chrome',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'Brave Browser.app/Contents/MacOS/Brave Browser',
  'Chromium.app/Contents/MacOS/Chromium',
  'Arc.app/Contents/MacOS/Arc',
  'Vivaldi.app/Contents/MacOS/Vivaldi',
];
const WIN_APPS = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
  'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'Chromium\\Application\\chrome.exe',
];
const LINUX_BINS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];

/** First installed Chromium-based browser (Chrome, Edge, Brave…), or CRATE_BROWSER. */
export function findBrowser(): string | null {
  if (process.env.CRATE_BROWSER) return process.env.CRATE_BROWSER;
  let candidates: string[];
  if (process.platform === 'darwin') {
    candidates = MAC_APPS.flatMap((app) => [path.join('/Applications', app), path.join(os.homedir(), 'Applications', app)]);
  } else if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((r): r is string => !!r);
    candidates = roots.flatMap((root) => WIN_APPS.map((app) => path.join(root, app)));
  } else {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    candidates = dirs.flatMap((dir) => LINUX_BINS.map((bin) => path.join(dir, bin)));
  }
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export class NoBrowserError extends Error {
  constructor() {
    super('No Chromium-based browser found (Chrome, Edge, Brave). Install one or set CRATE_BROWSER=/path/to/browser.');
    this.name = 'NoBrowserError';
  }
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, any>;
  sessionId?: string;
  result?: any;
  error?: { message: string };
}

/**
 * A real browser window driven over the Chrome DevTools Protocol. It is the SoundCloud session:
 * the user logs in there, and API calls can be routed through it so they carry a genuine
 * browser fingerprint (SoundCloud's anti-bot layer rejects plain HTTP clients).
 */
export class Browser {
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Set<(m: CdpMessage) => void>();
  private pageSession: string | null = null;
  private down = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly ws: WebSocket,
  ) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as CdpMessage);
    ws.onclose = () => this.teardown();
    ws.onerror = () => this.teardown();
    child.on('exit', () => this.teardown());
  }

  static async launch(exe: string, url: string, profileDir = BROWSER_PROFILE_DIR): Promise<Browser> {
    await fsp.mkdir(profileDir, { recursive: true });
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    await fsp.rm(portFile, { force: true });
    const extra = (process.env.CRATE_BROWSER_FLAGS ?? '').split(' ').filter(Boolean);
    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-features=Translate',
      '--window-size=1100,800',
      ...extra,
      url,
    ];
    const child = spawn(exe, args, { stdio: 'ignore' });
    let exited = false;
    child.once('exit', () => (exited = true));
    child.once('error', () => (exited = true));

    const deadline = Date.now() + 30_000;
    let endpoint: string | undefined;
    while (!endpoint) {
      try {
        const [port, wsPath] = (await fsp.readFile(portFile, 'utf8')).trim().split('\n');
        if (port && wsPath) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
      } catch {
        /* not written yet */
      }
      if (endpoint) break;
      if (exited) throw new Error('The browser exited before it could be controlled. If a FREEBASS browser window is already open, close it and retry.');
      if (Date.now() > deadline) {
        child.kill();
        throw new Error('Timed out waiting for the browser to start.');
      }
      await sleep(100);
    }

    const ws = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not connect to the browser DevTools socket.'));
    });
    debug('browser launched', exe);
    return new Browser(child, ws);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.down || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Browser session closed.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  /** Value of a cookie set for the SoundCloud host, or null. */
  async cookie(name: string): Promise<string | null> {
    const { cookies } = await this.send<{ cookies: Array<{ name: string; value: string; domain: string }> }>('Storage.getCookies');
    return cookies.find((c) => c.name === name && matchesHost(c.domain))?.value ?? null;
  }

  /** Open a foreground tab (used to show the login page when the browser is already running). */
  async open(url: string): Promise<void> {
    const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url });
    await this.send('Target.activateTarget', { targetId }).catch(() => undefined);
  }

  /** Run a fetch inside a SoundCloud tab: genuine browser TLS/HTTP2 fingerprint, passes the anti-bot layer. */
  async fetch(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.page();
      try {
        if ((await this.evaluate<string>('location.origin', session)) !== WEB_BASE) {
          await this.send('Page.navigate', { url: `${WEB_BASE}/` }, session);
          await this.waitForLoad(session);
        }
        const res = await this.evaluate<HttpResponse>(
          `(async () => {
            try {
              const r = await fetch(${JSON.stringify(url)}, { headers: ${JSON.stringify(headers)} });
              const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
              return { status: r.status, headers: h, body: await r.text() };
            } catch (e) { return { status: 0, headers: {}, body: String((e && e.message) || e) }; }
          })()`,
          session,
        );
        if (res.status === 0 && attempt < 1) continue; // tab navigated mid-request → retry once
        return res;
      } catch (err) {
        this.pageSession = null; // execution context gone → re-attach once
        if (attempt >= 1) throw err;
      }
    }
  }

  /** Watch the tab's own API traffic for a client_id (fallback when the JS bundle cannot be scraped). */
  async sniffClientId(timeoutMs = 20_000): Promise<string | null> {
    const session = await this.page();
    await this.send('Network.enable', {}, session);
    try {
      return await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          off();
          resolve(null);
        }, timeoutMs);
        const off = this.on((m) => {
          if (m.method !== 'Network.requestWillBeSent' || m.sessionId !== session) return;
          const hit = /[?&]client_id=([0-9A-Za-z]{32})/.exec(String(m.params?.request?.url ?? ''));
          if (hit) {
            clearTimeout(timer);
            off();
            resolve(hit[1] as string);
          }
        });
        this.send('Page.reload', {}, session).catch(() => undefined);
      });
    } finally {
      await this.send('Network.disable', {}, session).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (!this.down) await Promise.race([this.send('Browser.close').catch(() => undefined), sleep(2000)]);
    this.ws.close();
    this.teardown();
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
    const exited = new Promise<void>((resolve) => (this.child.exitCode === null ? this.child.once('exit', () => resolve()) : resolve()));
    await Promise.race([exited, sleep(3000).then(() => this.child.kill('SIGKILL'))]);
  }

  private on(listener: (m: CdpMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private onMessage(m: CdpMessage): void {
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (p) {
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      }
      return;
    }
    if (m.method === 'Target.detachedFromTarget' && m.params?.sessionId === this.pageSession) this.pageSession = null;
    for (const l of this.listeners) l(m);
  }

  private teardown(): void {
    if (this.down) return;
    this.down = true;
    for (const p of this.pending.values()) p.reject(new Error('Browser session closed.'));
    this.pending.clear();
    this.resolveClosed();
  }

  private async evaluate<T>(expression: string, sessionId: string): Promise<T> {
    const { result, exceptionDetails } = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  }

  private async waitForLoad(sessionId: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if ((await this.evaluate<string>('document.readyState', sessionId).catch(() => 'loading')) === 'complete') return;
      await sleep(100);
    }
  }

  /** Our own background tab on the SoundCloud origin; the user's tabs are left alone. */
  private async page(): Promise<string> {
    if (this.pageSession) return this.pageSession;
    const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url: `${WEB_BASE}/`, background: true });
    const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    this.pageSession = sessionId;
    await this.waitForLoad(sessionId);
    return sessionId;
  }
}

function matchesHost(cookieDomain: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase();
  return d === WEB_HOST || WEB_HOST.endsWith(`.${d}`);
}
