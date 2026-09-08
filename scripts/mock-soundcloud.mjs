#!/usr/bin/env node
/**
 * Offline stand-in for soundcloud.com (web), api-v2.soundcloud.com (API + CDN), so the whole flow —
 * client_id, login, scan, recap, download, index — can be exercised without touching SoundCloud.
 *
 *   node scripts/mock-soundcloud.mjs [port=8787]        web on :port, API + CDN on :port+1
 *
 * then in another terminal:
 *   CRATE_WEB_BASE=http://127.0.0.1:8787 CRATE_API_BASE=http://127.0.0.1:8788 \
 *   CRATE_CONFIG_DIR=/tmp/crate-mock/config CRATE_LIBRARY_DIR=/tmp/crate-mock/library npm start
 *
 * Curator URL to paste: soundcloud.com/curator — the fake sign-in page logs you in by itself after 2 s.
 * MOCK_DATADOME=1 makes /users/:id/tracks answer 403 like DataDome unless the call comes from a browser tab.
 */
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8787);
const WEB = `http://127.0.0.1:${PORT}`;
const API = `http://127.0.0.1:${PORT + 1}`;
const CLIENT_ID = 'MOCKCLIENTID0123456789abcdefABCD';
const TOKEN = '2-000000-1234567-mocktokenvalue';
const DATADOME = process.env.MOCK_DATADOME === '1';

let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const FORMATS = ['wav', 'wav', 'aiff', 'flac', 'mp3', 'mp3', 'm4a', null];
const MIME = { wav: 'audio/wav', aiff: 'audio/x-aiff', flac: 'audio/flac', mp3: 'audio/mpeg', m4a: 'audio/mp4' };

const curator = { id: 1, kind: 'user', username: 'The Curator', permalink: 'curator', permalink_url: 'https://soundcloud.com/curator', followings_count: 5 };
const me = { id: 999, kind: 'user', username: 'Mock DJ', permalink: 'mock-dj' };
const followings = [];
const tracksByUser = new Map();
const tracks = new Map();
let nextId = 1000;
for (const [permalink, username, count] of [
  ['label-a', 'Label A', 230],
  ['artist-b', 'Artist B', 25],
  ['deep-cuts', 'Deep Cuts', 60],
  ['podcast-guy', 'Podcast Guy', 8],
  ['empty-acct', 'Empty Account', 0],
]) {
  const user = { id: 10 + followings.length, kind: 'user', username, permalink, permalink_url: `https://soundcloud.com/${permalink}`, followings_count: 0, track_count: count };
  followings.push(user);
  const list = [];
  for (let k = 1; k <= count; k++) {
    const long = permalink === 'podcast-guy' || rand() < 0.08;
    const track = {
      id: nextId++,
      kind: 'track',
      title: `${username} Track ${k}${long ? ' (Long Mix)' : ''}`,
      permalink: `track-${k}`,
      permalink_url: `https://soundcloud.com/${permalink}/track-${k}`,
      duration: long ? 45 * 60_000 : 120_000 + Math.floor(rand() * 480_000),
      downloadable: rand() < 0.45,
      has_downloads_left: rand() < 0.9,
      sharing: rand() < 0.95 ? 'public' : 'private',
      streamable: true,
      policy: 'ALLOW',
      state: 'finished',
      user,
    };
    // Server-side only (non-enumerable → never serialised).
    Object.defineProperty(track, '_fmt', { value: FORMATS[Math.floor(rand() * FORMATS.length)] });
    Object.defineProperty(track, '_forbid', { value: rand() < 0.03 });
    Object.defineProperty(track, '_size', { value: 200_000 + Math.floor(rand() * 1_800_000) });
    list.push(track);
    tracks.set(track.id, track);
  }
  tracksByUser.set(user.id, list);
}

const send = (res, status, type, body, extra = {}) => {
  res.writeHead(status, { 'content-type': type, ...extra });
  res.end(body);
};
const json = (res, status, body, extra) => send(res, status, 'application/json', JSON.stringify(body), extra);
const paginate = (list, url) => {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const next = offset + limit < list.length ? `${API}${url.pathname}?offset=${offset + limit}&limit=${limit}` : null;
  return { collection: list.slice(offset, offset + limit), next_href: next };
};
const disposition = (t) => `attachment; filename="${t.title}.${t._fmt}"`;

function web(req, res) {
  const url = new URL(req.url, WEB);
  console.log('web ', req.method, url.pathname);
  switch (url.pathname) {
    case '/':
      return send(res, 200, 'text/html', `<!doctype html><title>Mock SoundCloud</title><h1>Mock SoundCloud</h1><script src="${WEB}/assets/vendor.js"></script><script src="${WEB}/assets/app.js"></script>`);
    case '/assets/vendor.js':
      return send(res, 200, 'text/javascript', 'window.vendor = 1;');
    case '/assets/app.js':
      return send(res, 200, 'text/javascript', `window.sc={client_id:"${CLIENT_ID}",env:"mock"};fetch("${API}/me?client_id=${CLIENT_ID}").catch(()=>{});`);
    case '/signin':
      return send(res, 200, 'text/html', '<h1>Mock sign-in</h1><p>Logging you in in 2 s…</p><script>setTimeout(()=>{location.href="/mock-login"},2000)</script>');
    case '/mock-login':
      res.writeHead(302, { 'set-cookie': `oauth_token=${TOKEN}; Path=/; Max-Age=31536000; HttpOnly`, location: '/' });
      return res.end();
    default:
      return send(res, 404, 'text/plain', 'not found');
  }
}

function api(req, res) {
  const url = new URL(req.url, API);
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('vary', 'origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const fromBrowser = 'sec-ch-ua' in req.headers; // client hints: only real Chromium sends them
  console.log('api ', req.method, url.pathname, fromBrowser ? '(browser)' : '', req.headers.authorization ? '(auth)' : '');

  const cdn = /^\/cdn\/(\d+)$/.exec(url.pathname);
  if (cdn) {
    const t = tracks.get(Number(cdn[1]));
    if (!t) return json(res, 404, {});
    if (t.id % 41 === 0) return json(res, 500, { error: 'cdn hiccup' });
    const headers = { 'content-length': String(t._size), 'content-type': t._fmt ? MIME[t._fmt] : 'application/octet-stream' };
    if (t._fmt) headers['content-disposition'] = disposition(t);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    let sent = 0;
    const chunk = Buffer.alloc(64 * 1024, 1);
    const pump = () => {
      while (sent < t._size) {
        const n = Math.min(chunk.length, t._size - sent);
        sent += n;
        if (!res.write(chunk.subarray(0, n))) return res.once('drain', () => setTimeout(pump, 2));
      }
      res.end();
    };
    return pump();
  }

  if (url.searchParams.get('client_id') !== CLIENT_ID) return json(res, 401, { error: 'invalid client_id' });
  if (Math.random() < 0.02) return json(res, 429, { error: 'rate limited' }, { 'retry-after': '1' });
  const auth = req.headers.authorization === `OAuth ${TOKEN}`;
  let m;
  if (url.pathname === '/me') return auth ? json(res, 200, me) : json(res, 401, { error: 'unauthorized' });
  if (url.pathname === '/resolve') {
    const name = (url.searchParams.get('url') ?? '').split('/').filter(Boolean).pop();
    const user = [curator, ...followings].find((u) => u.permalink === name);
    return user ? json(res, 200, user) : json(res, 404, {});
  }
  if ((m = /^\/users\/(\d+)\/followings$/.exec(url.pathname))) return json(res, 200, paginate(Number(m[1]) === curator.id ? followings : [], url));
  if ((m = /^\/users\/(\d+)\/tracks$/.exec(url.pathname))) {
    if (DATADOME && !fromBrowser) return json(res, 403, { url: 'https://geo.captcha-delivery.com/captcha/?initialCid=mock' });
    return json(res, 200, paginate(tracksByUser.get(Number(m[1])) ?? [], url));
  }
  if ((m = /^\/tracks\/(\d+)\/download$/.exec(url.pathname))) {
    const t = tracks.get(Number(m[1]));
    if (!t) return json(res, 404, {});
    if (!auth) return json(res, 401, { error: 'login required' });
    if (t._forbid) return json(res, 403, { error: 'not available' });
    const cd = t._fmt ? `&response-content-disposition=${encodeURIComponent(disposition(t))}` : '';
    return json(res, 200, { redirectUri: `${API}/cdn/${t.id}?Expires=1&Signature=mock${cd}` });
  }
  return json(res, 404, { error: 'not found' });
}

http.createServer(web).listen(PORT, '127.0.0.1');
http.createServer(api).listen(PORT + 1, '127.0.0.1', () => {
  const all = [...tracks.values()];
  const eligible = all.filter((t) => t.downloadable && t.has_downloads_left && t.sharing === 'public' && t.duration <= 12 * 60_000);
  console.log(`mock SoundCloud: web ${WEB} · api ${API} · curator soundcloud.com/curator`);
  console.log(`${all.length} tracks, ${eligible.length} eligible (${eligible.filter((t) => t._forbid).length} answer 403, ${eligible.filter((t) => !t._forbid && t.id % 41 === 0).length} fail on the CDN)${DATADOME ? ' · DataDome simulation ON' : ''}`);
});
