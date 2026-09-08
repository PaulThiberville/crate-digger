import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'crate-lib-'));
process.env.CRATE_LIBRARY_DIR = root;
const { Library } = await import('../src/core/library.js');

test('dedup: none → have → stale, following spec §2.4', async () => {
  const lib = await Library.open();
  assert.equal(await lib.check(1), 'none');

  const target = lib.target('Label', 'Track One', 1, 'wav');
  assert.equal(target.rel, 'Label - Track One.wav');
  assert.equal(target.abs, path.join(root, 'Label - Track One.wav'), 'flat: files sit at the library root');
  await fs.writeFile(target.abs, 'audio');
  await lib.record({ id: '1', path: target.rel, title: 'Track One' });
  assert.equal(await lib.check(1), 'have');

  const index = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'));
  assert.deepEqual(index.map((e: { id: string; path: string }) => [e.id, e.path]), [['1', 'Label - Track One.wav']]);

  await fs.rm(target.abs);
  assert.equal(await lib.check(1), 'stale');
  assert.equal(await lib.check(1), 'none', 'stale entry is dropped');
});

test('record upserts by id and survives reopening', async () => {
  const lib = await Library.open();
  await lib.record({ id: '7', path: 'A - B.mp3' });
  await lib.record({ id: '7', path: 'A - B [7].mp3' });
  const again = await Library.open();
  assert.equal(again.size, 1);
  assert.equal(await again.check('7'), 'stale', 'indexed but missing on disk → re-download');
  assert.equal(again.size, 0);
});

test('target never clobbers another track with the same name', async () => {
  const lib = await Library.open();
  const first = lib.target('Up', 'Same Title', 100, 'mp3');
  await fs.writeFile(first.abs, 'x');
  await lib.record({ id: '100', path: first.rel });
  assert.equal(lib.target('Up', 'Same Title', 100, 'mp3').rel, first.rel, 'same track keeps its path');
  assert.equal(lib.target('Up', 'Same Title', 200, 'mp3').rel, 'Up - Same Title [200].mp3');
});
