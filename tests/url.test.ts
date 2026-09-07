import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCuratorUrl } from '../src/core/url.js';

test('parseCuratorUrl accepts profile URLs in their common shapes', () => {
  assert.equal(parseCuratorUrl('https://soundcloud.com/some-curator'), 'some-curator');
  assert.equal(parseCuratorUrl('soundcloud.com/Some_Curator/'), 'some_curator');
  assert.equal(parseCuratorUrl('http://m.soundcloud.com/curator?ref=x'), 'curator');
  assert.equal(parseCuratorUrl('https://www.soundcloud.com/curator/tracks'), 'curator');
  assert.equal(parseCuratorUrl('  curator  '), 'curator');
});

test('parseCuratorUrl rejects anything that is not a profile', () => {
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
  ]) assert.equal(parseCuratorUrl(bad), null, bad);
});
