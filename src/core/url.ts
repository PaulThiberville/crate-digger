/** soundcloud.com paths that are pages, not profiles. */
const RESERVED_PATHS = new Set([
  'discover', 'search', 'you', 'stream', 'upload', 'settings', 'messages', 'notifications', 'charts', 'pages',
  'mobile', 'feed', 'people', 'tags', 'popular', 'terms-of-use', 'jobs', 'imprint', 'logout', 'login', 'signin',
  'signup', 'pro', 'premium', 'go', 'artist', 'music', 'tracks', 'playlists', 'albums', 'sets', 'stations',
  'groups', 'apps', 'help', 'blog', 'creators', 'press', 'legal', 'cookies', 'privacy', 'for', 'explore',
]);

/** Profile sub-pages we tolerate after the username. */
const PROFILE_TABS = new Set(['tracks', 'popular-tracks', 'albums', 'sets', 'reposts', 'likes', 'followers', 'following']);

const PERMALINK = /^[a-z0-9_-]{1,64}$/;

/**
 * Accepts `https://soundcloud.com/name`, `soundcloud.com/name/`, `m.soundcloud.com/name/tracks`
 * or a bare `name`. Returns the permalink, or null when it is not a profile URL.
 */
export function parseCuratorUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (!raw.includes('/') && !raw.includes('.')) return PERMALINK.test(raw.toLowerCase()) ? raw.toLowerCase() : null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^(www\.|m\.)?soundcloud\.com$/i.test(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const [name, tab, ...rest] = segments;
  if (!name || rest.length > 0 || (tab && !PROFILE_TABS.has(tab))) return null;
  if (!PERMALINK.test(name) || RESERVED_PATHS.has(name)) return null;
  return name;
}
