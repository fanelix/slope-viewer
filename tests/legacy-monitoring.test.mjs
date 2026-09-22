import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  legacyParseMonitoring,
  loadLegacyDependencies,
} from './helpers/legacy-reference.mjs';
import { parseMonitoringCsv } from '../src/monitoring-core.js';

test('current monitoring data remains valid and matches the legacy parser', async () => {
  const text = await readFile(
    new URL('../data/monitoring.csv', import.meta.url),
    'utf8',
  );
  const { Papa } = await loadLegacyDependencies();
  const legacy = legacyParseMonitoring(text, Papa);
  const optimized = parseMonitoringCsv(text, Papa);

  assert.ok(text.trim().length > 0);
  assert.ok(optimized.length > 0);
  assert.deepEqual(optimized, legacy);
  for (const point of optimized) {
    assert.ok([
      point.e0,
      point.n0,
      point.z0,
      point.e1,
      point.n1,
      point.z1,
      point.dE,
      point.dN,
      point.dZ,
      point.disp2D,
      point.dispTotal,
      point.azimuth,
    ].every(Number.isFinite));
    assert.ok(['Aman', 'Waspada', 'Bahaya'].includes(point.category.name));
  }
});
