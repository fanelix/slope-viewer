import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('performance verification records required evidence', async () => {
  const report = await readFile(
    new URL('../docs/performance-verification.md', import.meta.url),
    'utf8',
  );
  for (const heading of [
    'Geometry equivalence',
    'Visual equivalence',
    'Network payload',
    'Worker responsiveness',
    'Idle rendering',
    'Draw calls',
    'Weekly replacement drill',
  ]) {
    assert.match(report, new RegExp(`^## ${heading}$`, 'm'));
  }
});
