import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileName } from '../src/core/filename.js';

test('fileName: "Uploader - Title.ext", readable and Windows-safe', () => {
  assert.equal(fileName('Label A', 'Track 7', 'wav'), 'Label A - Track 7.wav');
  assert.equal(fileName('Deep Cuts', 'Nuit: "Live" <mix> / edit?', 'mp3'), 'Deep Cuts - Nuit Live mix edit.mp3');
  assert.equal(fileName('Élévation', 'Résumé (Original Mix)', 'flac'), 'Élévation - Résumé (Original Mix).flac');
});

test('fileName: empty parts, trailing dots and reserved names', () => {
  assert.equal(fileName('', 'Title...', 'wav'), 'Title.wav');
  assert.equal(fileName('  ', '', 'wav'), 'untitled.wav');
  assert.equal(fileName('', 'CON', 'wav'), 'CON (track).wav');
});

test('fileName: long names are capped', () => {
  assert.ok(fileName('a'.repeat(200), 'b'.repeat(200), 'aiff').length <= 125);
});
