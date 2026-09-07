import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, detectExt, eligibility } from '../src/core/filter.js';
import type { ScTrack } from '../src/core/types.js';

const MAX = 12 * 60_000;
const base: ScTrack = {
  id: 1,
  kind: 'track',
  title: 't',
  permalink: 't',
  duration: 5 * 60_000,
  downloadable: true,
  has_downloads_left: true,
  sharing: 'public',
  streamable: true,
};

test('eligibility: official free download, public, short → eligible', () => {
  assert.equal(eligibility(base, MAX), null);
});

test('eligibility: every gate has its own reason', () => {
  assert.equal(eligibility({ ...base, downloadable: false }, MAX), 'not_downloadable');
  assert.equal(eligibility({ ...base, downloadable: undefined }, MAX), 'not_downloadable');
  assert.equal(eligibility({ ...base, has_downloads_left: false }, MAX), 'no_downloads_left');
  assert.equal(eligibility({ ...base, sharing: 'private' }, MAX), 'not_public');
  assert.equal(eligibility({ ...base, streamable: false }, MAX), 'not_public');
  assert.equal(eligibility({ ...base, duration: MAX + 1 }, MAX), 'too_long');
  assert.equal(eligibility({ ...base, duration: MAX }, MAX), null);
});

test('classify: lossless originals are HIGH, the rest LOW, nothing known is UNKNOWN', () => {
  for (const ext of ['wav', 'WAV', 'aiff', 'aif', 'flac', 'alac']) assert.equal(classify(ext), 'HIGH', ext);
  for (const ext of ['mp3', 'm4a', 'aac', 'ogg', 'opus']) assert.equal(classify(ext), 'LOW', ext);
  assert.equal(classify(undefined), 'UNKNOWN');
});

test('detectExt: Content-Disposition wins, in both syntaxes', () => {
  assert.equal(detectExt({ contentDisposition: 'attachment; filename="Artist - Title.WAV"', contentType: 'audio/mpeg' }), 'wav');
  assert.equal(detectExt({ contentDisposition: "attachment; filename*=UTF-8''Caf%C3%A9%20Mix.aiff" }), 'aiff');
  assert.equal(detectExt({ contentDisposition: 'attachment; filename=plain.flac' }), 'flac');
});

test('detectExt: falls back to the signed URL, then the MIME type', () => {
  const url = 'https://cdn.example/abc123?response-content-disposition=' + encodeURIComponent('attachment; filename="x.wav"') + '&Expires=1';
  assert.equal(detectExt({ url }), 'wav');
  assert.equal(detectExt({ url: 'https://cdn.example/path/file.mp3?sig=1' }), 'mp3');
  assert.equal(detectExt({ contentType: 'audio/x-aiff; charset=binary' }), 'aiff');
  assert.equal(detectExt({ contentType: 'application/octet-stream', url: 'https://cdn.example/opaque' }), undefined);
});
