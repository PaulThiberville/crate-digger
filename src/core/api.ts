import { API_BASE, PAGE_LIMIT, SCAN_CONCURRENCY } from '../config.js';
import type { Browser } from './browser.js';
import { saveClientId, scrapeClientId } from './clientId.js';
import { debug } from './debug.js';
import { directTransport, isDataDome, type HttpResponse } from './http.js';
import type { ScTrack, ScUser } from './types.js';
import { backoff, Limiter, sleep } from './util.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiHooks {
  /** The anti-bot layer rejected a plain request: return a browser to route calls through, or null. */
  needBrowser?: () => Promise<Browser | null>;
  status?: (message: string) => void;
}

/** api-v2 client: public endpoints + the official `/tracks/{id}/download` link. Nothing else. */
export class SoundCloud {
  token: string | null = null;
  private browser: Browser | null = null;
  private readonly limiter = new Limiter(SCAN_CONCURRENCY, 120);
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private clientId: string,
    private readonly hooks: ApiHooks = {},
  ) {}

  get viaBrowser(): boolean {
    return this.browser !== null;
  }

  /** Route calls through a browser tab (genuine fingerprint). Falls back to direct when it closes. */
  useBrowser(browser: Browser | null): void {
    this.browser = browser;
    if (browser) {
      void browser.closed.then(() => {
        if (this.browser === browser) this.browser = null;
      });
    }
  }

  resolveUser(profileUrl: string): Promise<ScUser> {
    return this.get<ScUser>('/resolve', { url: profileUrl });
  }

  me(): Promise<ScUser> {
    return this.get<ScUser>('/me');
  }

  followings(userId: number): AsyncGenerator<ScUser> {
    return this.collection<ScUser>(`/users/${userId}/followings`);
  }

  tracks(userId: number): AsyncGenerator<ScTrack> {
    return this.collection<ScTrack>(`/users/${userId}/tracks`);
  }

  /** The only sanctioned way to get a file (spec §5.1). 401 = login required, 403 = not available / quota. */
  async downloadUrl(trackId: number): Promise<string> {
    const { redirectUri } = await this.get<{ redirectUri?: string }>(`/tracks/${trackId}/download`, {}, { strict: true });
    if (!redirectUri) throw new ApiError(404, 'no download link');
    return redirectUri;
  }

  private async *collection<T>(pathname: string): AsyncGenerator<T> {
    let next: string | null = this.buildUrl(pathname, { limit: PAGE_LIMIT, linked_partitioning: 1 });
    const seen = new Set<string>();
    while (next && !seen.has(next)) {
      seen.add(next);
      const page: { collection?: T[]; next_href?: string | null } = await this.get(next);
      for (const item of page.collection ?? []) yield item;
      next = page.next_href ? this.buildUrl(page.next_href) : null; // next_href comes without client_id
    }
  }

  private buildUrl(pathOrUrl: string, params: Record<string, string | number> = {}): string {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set('client_id', this.clientId);
    return url.toString();
  }

  /**
   * GET JSON with: backoff on 429/5xx, one client_id refresh on 401/403, and a switch to the
   * browser transport when DataDome blocks plain requests.
   * `strict`: the status carries meaning (download endpoint) → never refresh, only react to DataDome.
   */
  private async get<T>(pathOrUrl: string, params: Record<string, string | number> = {}, opts: { strict?: boolean } = {}): Promise<T> {
    let refreshed = false;
    let switched = false;
    for (let attempt = 0; ; attempt++) {
      const url = this.buildUrl(pathOrUrl, params);
      const headers: Record<string, string> = this.token ? { Authorization: `OAuth ${this.token}` } : {};
      let res: HttpResponse;
      try {
        res = await this.limiter.run(() => (this.browser ? this.browser.fetch(url, headers) : directTransport(url, headers)));
      } catch (err) {
        if (attempt >= 3) throw err;
        debug('network error', String(err));
        await sleep(backoff(attempt));
        continue;
      }
      debug('GET', url.replace(/client_id=[^&]+/, 'client_id=…'), res.status, this.browser ? 'browser' : 'direct');

      if (res.status === 200) {
        try {
          return JSON.parse(res.body) as T;
        } catch {
          throw new ApiError(200, 'invalid JSON from SoundCloud');
        }
      }
      if (res.status === 429 || res.status >= 500 || res.status === 0) {
        if (attempt >= 6) throw new ApiError(res.status, res.status === 429 ? 'rate limited' : `HTTP ${res.status}`);
        await sleep(retryAfterMs(res) ?? backoff(attempt, 2000));
        continue;
      }
      if (res.status === 403 && !this.browser && !switched && this.hooks.needBrowser && (isDataDome(res) || (!opts.strict && refreshed))) {
        switched = true;
        this.hooks.status?.('anti-bot check → routing calls through the browser session');
        const browser = await this.hooks.needBrowser();
        if (browser) {
          this.useBrowser(browser);
          continue;
        }
      }
      if ((res.status === 401 || res.status === 403) && !refreshed && !opts.strict) {
        refreshed = true;
        if (await this.refreshClientId()) continue;
      }
      throw new ApiError(res.status, describe(res.status));
    }
  }

  /** Shared between concurrent callers: one scrape (or one sniff through the browser) at a time. */
  private refreshClientId(): Promise<boolean> {
    this.refreshing ??= (async () => {
      this.hooks.status?.('refreshing SoundCloud client_id');
      const browser = this.browser;
      const id = (await scrapeClientId(browser ? (u, h) => browser.fetch(u, h) : directTransport)) ?? (browser ? await browser.sniffClientId() : null);
      if (!id || id === this.clientId) return false;
      this.clientId = id;
      await saveClientId(id);
      return true;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}

function retryAfterMs(res: HttpResponse): number | undefined {
  const seconds = Number(res.headers['retry-after']);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : undefined;
}

function describe(status: number): string {
  return ({ 401: 'login required', 403: 'forbidden', 404: 'not found' } as Record<number, string>)[status] ?? `HTTP ${status}`;
}
