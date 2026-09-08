import fsp from 'node:fs/promises';
import { CONFIG_DIR, LOGIN_TIMEOUT_MS, WEB_BASE } from '../config.js';
import { SoundCloud } from '../core/api.js';
import { clearSession, loadSession, saveSession, verifyToken, waitForLogin } from '../core/auth.js';
import type { ChildProcess } from 'node:child_process';
import { Browser, NoBrowserError, findBrowser, launchPlain, stopProcess } from '../core/browser.js';
import { loadClientId, saveClientId, scrapeClientId } from '../core/clientId.js';
import { downloadSelection, type DownloadStats } from '../core/download.js';
import { Library } from '../core/library.js';
import { scanCurator, type ScanResult, type ScanStats } from '../core/scan.js';
import type { Candidate, ScUser, Session } from '../core/types.js';
import { sleep } from '../core/util.js';

/** Everything the TUI drives, without React: boot, login, scan, download, shutdown. */
export class Runtime {
  api!: SoundCloud;
  library!: Library;
  browser: Browser | null = null;
  session: Session | null = null;
  readonly abort = new AbortController();
  onStatus: (message: string) => void = () => undefined;
  private launching: Promise<Browser> | null = null;
  private plainWindow: ChildProcess | null = null;

  constructor(readonly maxMinutes: number) {}

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** client_id + library + saved session check. */
  async boot(): Promise<'ready' | 'login-needed'> {
    await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    this.library = await Library.open();

    this.onStatus('connecting to SoundCloud…');
    let clientId = await loadClientId();
    if (!clientId) clientId = await scrapeClientId();
    if (!clientId) {
      // Plain requests blocked: let a real browser fetch the bundle, or watch its own API calls.
      const browser = await this.ensureBrowser();
      clientId = (await scrapeClientId((u, h) => browser.fetch(u, h))) ?? (await browser.sniffClientId());
    }
    if (!clientId) throw new Error('Could not obtain a SoundCloud client_id.');
    await saveClientId(clientId);

    this.api = new SoundCloud(clientId, {
      needBrowser: () =>
        this.ensureBrowser().catch((err: Error) => {
          this.onStatus(err.message);
          return null;
        }),
      status: (m) => this.onStatus(m),
    });
    if (this.browser) this.api.useBrowser(this.browser);

    const saved = await loadSession();
    if (saved) {
      this.onStatus('checking saved session…');
      const me = await verifyToken(this.api, saved.token);
      if (me) {
        this.api.token = saved.token;
        this.session = { ...saved, username: me.username, permalink: me.permalink, userId: me.id };
        return 'ready';
      }
      await clearSession();
    }
    return 'login-needed';
  }

  /** Open SoundCloud's sign-in page in a controlled browser window and wait for the session cookie. */
  async login(signal: AbortSignal): Promise<ScUser | null> {
    const signin = `${WEB_BASE}/signin`;
    const existing = this.browser;
    const browser = existing ?? (await this.ensureBrowser(signin));
    if (existing) await existing.open(signin).catch(() => undefined); // already running: show the login page in a new tab
    this.onStatus('waiting for you to log in in the browser window…');
    const token = await waitForLogin(browser, { timeoutMs: LOGIN_TIMEOUT_MS, signal });
    const me = token ? await this.adoptToken(token) : null;
    await this.releaseBrowser();
    return me;
  }

  /**
   * Fallback for sign-in providers that refuse remote-controlled browsers: a plain window on the same
   * profile. Chrome only writes cookies to disk on a clean quit, so we wait for the user to quit that
   * browser (never kill it), then read the cookie through DevTools.
   */
  async loginManual(skipped: Promise<void>): Promise<ScUser | null> {
    const exe = findBrowser();
    if (!exe) throw new NoBrowserError();
    if (this.browser) await this.browser.close(); // frees the profile for the plain window
    const child = launchPlain(exe, `${WEB_BASE}/signin`);
    this.plainWindow = child;
    this.onStatus('log in in the plain window, then quit that browser');
    const quit = new Promise<boolean>((resolve) => child.once('exit', () => resolve(true)));
    const proceed = await Promise.race([quit, skipped.then(() => false), sleep(LOGIN_TIMEOUT_MS).then(() => false)]);
    this.plainWindow = null;
    if (!proceed) {
      await stopProcess(child);
      return null;
    }
    const token = await (await this.ensureBrowser()).cookie('oauth_token');
    const me = token ? await this.adoptToken(token) : null;
    await this.releaseBrowser();
    return me;
  }

  /** The window is only needed to log in and for the anti-bot fallback: never keep it open longer. */
  private async releaseBrowser(): Promise<void> {
    const browser = this.browser;
    if (!browser) return;
    this.browser = null;
    this.api.useBrowser(null);
    await browser.close();
  }

  private async adoptToken(token: string): Promise<ScUser | null> {
    const me = await verifyToken(this.api, token);
    if (!me) return null;
    this.api.token = token;
    this.session = { token, username: me.username, permalink: me.permalink, userId: me.id, savedAt: new Date().toISOString() };
    await saveSession(this.session);
    return me;
  }

  /** One browser window for the whole run; created on first need (login or anti-bot fallback). */
  ensureBrowser(url = `${WEB_BASE}/`): Promise<Browser> {
    if (this.browser) return Promise.resolve(this.browser);
    this.launching ??= (async () => {
      const exe = findBrowser();
      if (!exe) throw new NoBrowserError();
      this.onStatus('opening a browser window — separate Crate Digger profile, your own browser profile is untouched');
      const browser = await Browser.launch(exe, url);
      this.browser = browser;
      this.api?.useBrowser(browser);
      void browser.closed.then(() => {
        if (this.browser === browser) {
          this.browser = null;
          this.onStatus('browser window closed');
        }
      });
      return browser;
    })().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  async resolveCurator(permalink: string): Promise<ScUser> {
    const user = await this.api.resolveUser(`https://soundcloud.com/${permalink}`);
    if (user?.kind !== 'user' || !user.id) throw new Error('This URL is not a SoundCloud profile.');
    return user;
  }

  scan(curator: ScUser, onStats: (stats: ScanStats) => void): Promise<ScanResult> {
    return scanCurator(this.api, curator, { maxMs: this.maxMinutes * 60_000, probe: this.session !== null, signal: this.signal, onStats });
  }

  download(curator: ScUser, items: Candidate[], onStats: (stats: DownloadStats) => void): Promise<DownloadStats> {
    return downloadSelection(this.api, this.library, curator, items, { signal: this.signal, onStats });
  }

  async shutdown(): Promise<void> {
    this.abort.abort();
    if (this.plainWindow) await stopProcess(this.plainWindow).catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }
}

export type { DownloadStats, ScanStats };
