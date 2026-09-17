import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, type SoundCloud } from '../src/core/api.js';
import { scan, scanFollowings, scanLikes, type ScanOptions } from '../src/core/scan.js';
import type { ScTrack, ScUser } from '../src/core/types.js';

const MAX = 12 * 60_000;
const user = (id: number, permalink: string): ScUser => ({ id, kind: 'user', username: permalink.toUpperCase(), permalink });
const track = (id: number, by: ScUser, extra: Partial<ScTrack> = {}): ScTrack => ({
  id,
  kind: 'track',
  title: `Track ${id}`,
  permalink: `track-${id}`,
  duration: 5 * 60_000,
  downloadable: true,
  has_downloads_left: true,
  sharing: 'public',
  streamable: true,
  user: by,
  ...extra,
});

async function* gen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

/** Duck-typed stand-in: only the endpoints the scan touches. */
function api(impl: Partial<Pick<SoundCloud, 'followings' | 'tracks' | 'likes' | 'downloadUrl'>>): SoundCloud {
  return impl as unknown as SoundCloud;
}

const opts = (over: Partial<ScanOptions> = {}): ScanOptions => ({ maxMs: MAX, probe: false, signal: new AbortController().signal, ...over });

const alice = user(10, 'alice');
const bob = user(11, 'bob');
const liker = user(1, 'liker');

test('likes: every liked track is inspected, the uploader is the track owner', async () => {
  const liked = [
    track(100, alice),
    track(101, bob),
    track(102, alice, { downloadable: false }),
    track(103, bob, { duration: MAX + 1 }),
    track(104, bob, { sharing: 'private' }),
  ];
  const { stats, candidates } = await scanLikes(api({ likes: () => gen(liked) }), { mode: 'likes', profile: { ...liker, likes_count: 9 } }, opts());

  assert.equal(stats.total, 5, 'likes_count (tracks + playlists) is replaced by the number of liked tracks listed');
  assert.equal(stats.done, 5);
  assert.equal(stats.tracksSeen, 5);
  assert.equal(stats.eligible, 2);
  assert.deepEqual(stats.skipped, { not_downloadable: 1, no_downloads_left: 0, not_public: 1, too_long: 1, forbidden: 0 });
  assert.deepEqual(
    candidates.map((c) => [c.id, c.uploader, c.uploaderName, c.quality, c.loginRequired]).sort(),
    [
      [100, 'alice', 'ALICE', 'UNKNOWN', true],
      [101, 'bob', 'BOB', 'UNKNOWN', true],
    ],
    'without a login nothing is probed: format unknown, flagged login-required',
  );
  assert.equal(stats.loginRequired, 2);
  assert.equal(stats.current, 'done');
  assert.ok(stats.finishedAt);
});

test('likes: duplicates are inspected once, a track without owner gets a placeholder uploader', async () => {
  const t = track(200, alice);
  const orphan = track(201, alice, { user: undefined });
  const { stats, candidates } = await scanLikes(api({ likes: () => gen([t, t, orphan]) }), { mode: 'likes', profile: liker }, opts());
  assert.equal(stats.total, 2);
  assert.equal(stats.tracksSeen, 2);
  assert.deepEqual(candidates.map((c) => [c.id, c.uploader, c.uploaderName]), [
    [200, 'alice', 'ALICE'],
    [201, 'unknown', 'Unknown'],
  ]);
});

test('likes: with a login, the probe decides — 401 keeps the track as login-required, 403 drops it', async () => {
  const liked = [track(300, alice), track(301, bob)];
  const downloadUrl = async (id: number) => {
    throw new ApiError(id === 300 ? 401 : 403, id === 300 ? 'login required' : 'forbidden');
  };
  const { stats, candidates } = await scanLikes(api({ likes: () => gen(liked), downloadUrl }), { mode: 'likes', profile: liker }, opts({ probe: true }));
  assert.deepEqual(
    candidates.map((c) => [c.id, c.loginRequired]),
    [[300, true]],
  );
  assert.equal(stats.loginRequired, 1);
  assert.equal(stats.skipped.forbidden, 1);
  assert.equal(stats.eligible, 1);
});

test('likes: an aborted scan throws instead of returning a partial result', async () => {
  const ctrl = new AbortController();
  async function* likes(): AsyncGenerator<ScTrack> {
    yield track(400, alice);
    ctrl.abort();
    yield track(401, alice);
  }
  await assert.rejects(scanLikes(api({ likes }), { mode: 'likes', profile: liker }, opts({ signal: ctrl.signal })), (err: Error) => err.name === 'AbortError');
});

test('followings: curator → followings → their uploads, progress counted per following', async () => {
  const curator = { ...user(1, 'curator'), followings_count: 2 };
  const uploads = new Map<number, ScTrack[]>([
    [alice.id, [track(500, alice), track(501, alice, { has_downloads_left: false })]],
    [bob.id, [track(502, bob)]],
  ]);
  const { stats, candidates } = await scanFollowings(
    api({ followings: () => gen([alice, bob]), tracks: (id) => gen(uploads.get(id) ?? []) }),
    { mode: 'followings', profile: curator },
    opts(),
  );
  assert.equal(stats.total, 2);
  assert.equal(stats.done, 2);
  assert.equal(stats.tracksSeen, 3);
  assert.equal(stats.eligible, 2);
  assert.equal(stats.skipped.no_downloads_left, 1);
  assert.deepEqual(candidates.map((c) => [c.id, c.uploader]).sort(), [
    [500, 'alice'],
    [502, 'bob'],
  ]);
});

test('followings: one failing account is counted as an error, the others still get scanned', async () => {
  const curator = { ...user(1, 'curator'), followings_count: 2 };
  const tracks = (id: number) => (id === alice.id ? gen([track(600, alice)]) : (async function* () { throw new ApiError(500, 'HTTP 500'); })());
  const { stats, candidates } = await scanFollowings(api({ followings: () => gen([alice, bob]), tracks }), { mode: 'followings', profile: curator }, opts());
  assert.equal(stats.errors, 1);
  assert.equal(stats.done, 2);
  assert.deepEqual(candidates.map((c) => c.id), [600]);
});

test('scan dispatches on the mode', async () => {
  const sc = api({ likes: () => gen([track(700, alice)]), followings: () => gen([]), tracks: () => gen([]) });
  const likes = await scan(sc, { mode: 'likes', profile: liker }, opts());
  const followings = await scan(sc, { mode: 'followings', profile: liker }, opts());
  assert.equal(likes.candidates.length, 1);
  assert.equal(followings.candidates.length, 0);
  assert.equal(likes.stats.source.mode, 'likes');
  assert.equal(followings.stats.source.mode, 'followings');
});
