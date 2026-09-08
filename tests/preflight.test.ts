import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeVersionProblem } from '../src/preflight.js';

const versions = (node: string, bun?: string) => ({ node, bun }) as unknown as NodeJS.ProcessVersions;

test('Node 22+ passes, older Node gets a message naming the version found', () => {
  assert.equal(nodeVersionProblem(versions('22.0.0')), null);
  assert.equal(nodeVersionProblem(versions('24.3.1')), null);
  assert.match(nodeVersionProblem(versions('20.11.1')) ?? '', /Node 22 or newer, found 20\.11\.1/);
});

test('the standalone binary (Bun runtime) is never blocked', () => {
  assert.equal(nodeVersionProblem(versions('18.0.0', '1.3.11')), null);
});
