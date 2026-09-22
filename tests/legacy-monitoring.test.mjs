import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  legacyParseMonitoring,
  loadLegacyDependencies,
} from './helpers/legacy-reference.mjs';

function categoryCounts(points) {
  const counts = {};
  for (const point of points) {
    counts[point.category.name] = (counts[point.category.name] || 0) + 1;
  }
  return counts;
}

test('canonical monitoring baseline is frozen for the refactor', async () => {
  const text = await readFile(
    new URL('../data/monitoring.csv', import.meta.url),
    'utf8',
  );
  const { Papa } = await loadLegacyDependencies();
  const points = legacyParseMonitoring(text, Papa);

  assert.equal(points.length, 188);
  assert.deepEqual(categoryCounts(points), {
    Aman: 56,
    Waspada: 107,
    Bahaya: 25,
  });
  assert.equal(
    points.filter((point) => point.dE === 0 && point.dN === 0).length,
    4,
  );
  assert.equal(points.filter((point) => point.dZ !== 0).length, 169);
});
