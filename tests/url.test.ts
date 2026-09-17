import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProfileUrl } from '../src/core/url.js';

test('parseProfileUrl accepts profile URLs in their common shapes', () => {
  assert.equal(parseProfileUrl('https://soundcloud.com/some-curator'), 'some-curator');
  assert.equal(parseProfileUrl('soundcloud.com/Some_Curator/'), 'some_curator');
  assert.equal(parseProfileUrl('http://m.soundcloud.com/curator?ref=x'), 'curator');
  assert.equal(parseProfileUrl('https://www.soundcloud.com/curator/tracks'), 'curator');
  assert.equal(parseProfileUrl('https://soundcloud.com/some-dj/likes'), 'some-dj');
  assert.equal(parseProfileUrl('  curator  '), 'curator');
});

test('parseProfileUrl rejects anything that is not a profile', () => {
  for (const bad of [
    '',
    'not a url',
    'https://example.com/curator',
    'https://soundcloud.com/',
    'https://soundcloud.com/discover',
    'https://soundcloud.com/artist/some-track',
    'https://soundcloud.com/artist/sets/playlist',
    'https://on.soundcloud.com/abc',
    'ftp://soundcloud.com/x',
  ]) assert.equal(parseProfileUrl(bad), null, bad);
});
