import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeName, slugify } from '../src/core/slug.js';

test('slugify: ascii, lowercase, hyphens', () => {
  assert.equal(slugify('Deep Cuts Vol. 3 (Original Mix)'), 'deep-cuts-vol-3-original-mix');
});

test('slugify: strips diacritics and unsafe characters', () => {
  assert.equal(slugify('Élévation / Résumé: "Nuit" <live>'), 'elevation-resume-nuit-live');
});

test('slugify: empty or symbol-only titles use the fallback', () => {
  assert.equal(slugify('★★★', 'track-42'), 'track-42');
  assert.equal(slugify('   '), 'untitled');
});

test('slugify: Windows reserved names are avoided', () => {
  assert.equal(slugify('CON'), 'con-track');
  assert.equal(slugify('com1'), 'com1-track');
});

test('slugify: long titles are capped', () => {
  assert.ok(slugify('a'.repeat(500)).length <= 80);
});

test('safeName keeps permalinks recognisable', () => {
  assert.equal(safeName('some_label-01'), 'some_label-01');
  assert.equal(safeName('Weird/Name'), 'weird-name');
  assert.equal(safeName(''), 'unknown');
  assert.equal(safeName('nul'), 'nul-user');
});
