export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

export const isAbort = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

/** Exponential backoff with jitter: attempt 0 → ~base, capped. */
export function backoff(attempt: number, base = 1000, cap = 30_000): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  return exp / 2 + Math.random() * (exp / 2);
}

/** Bounded concurrency plus a minimum spacing between request starts (gentle on rate limits). */
export class Limiter {
  private active = 0;
  private lastStart = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly spacingMs: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) this.active++;
    else await new Promise<void>((resolve) => this.queue.push(resolve)); // slot handed over by release()
    const at = Math.max(Date.now(), this.lastStart + this.spacingMs);
    this.lastStart = at;
    const wait = at - Date.now();
    if (wait > 0) await sleep(wait);
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

/** Run `worker` over `items` with at most `concurrency` in flight. Workers must handle their own errors. */
export async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) await worker(items[i++] as T);
  });
  await Promise.all(lanes);
}

/** Rolling-window throughput. */
export class Speedometer {
  private samples: Array<[number, number]> = [];
  constructor(private readonly windowMs = 5000) {}

  add(totalBytes: number, now = Date.now()): void {
    this.samples.push([now, totalBytes]);
    while (this.samples.length > 2 && now - (this.samples[0] as [number, number])[0] > this.windowMs) this.samples.shift();
  }

  get bytesPerSec(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last[0] === first[0]) return 0;
    return (last[1] - first[1]) / ((last[0] - first[0]) / 1000);
  }
}

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v.toFixed(1)} ${units[u]}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
