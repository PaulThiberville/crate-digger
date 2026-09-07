import { USER_AGENT } from '../config.js';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Transport = (url: string, headers?: Record<string, string>) => Promise<HttpResponse>;

/** Plain fetch from this process. */
export const directTransport: Transport = async (url, headers = {}) => {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...headers },
  });
  return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
};

/** SoundCloud sits behind DataDome, which answers 403 (with a captcha URL) to non-browser TLS fingerprints. */
export function isDataDome(res: HttpResponse): boolean {
  if (res.status !== 403) return false;
  return (
    /captcha-delivery\.com|datadome/i.test(res.body) ||
    'x-datadome' in res.headers ||
    /datadome/i.test(res.headers['set-cookie'] ?? '')
  );
}
