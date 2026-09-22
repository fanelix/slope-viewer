import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildMonitoringTransforms,
  parseMonitoringCsv,
} from '../src/monitoring-core.js';
import {
  legacyParseMonitoring,
  loadLegacyDependencies,
} from './helpers/legacy-reference.mjs';

async function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

test('monitoring parser preserves all legacy values', async () => {
  const text = await read('../data/monitoring.csv');
  const { Papa } = await loadLegacyDependencies();
  const legacy = legacyParseMonitoring(text, Papa);
  const optimized = parseMonitoringCsv(text, Papa);

  assert.deepEqual(optimized, legacy);
});

test('immutable replacement fixture preserves classification boundaries', async () => {
  const text = await read('./fixtures/monitoring-sample.csv');
  const { Papa } = await loadLegacyDependencies();
  const points = parseMonitoringCsv(text, Papa);

  assert.deepEqual(
    points.map((point) => point.category.name),
    ['Aman', 'Waspada', 'Bahaya', 'Aman', 'Waspada', 'Bahaya'],
  );
  assert.deepEqual(points, legacyParseMonitoring(text, Papa));
});

test('zero-horizontal point keeps north placeholder and minimum length', () => {
  const point = {
    id: 'ZERO-01',
    e0: 10,
    n0: 20,
    z0: 10,
    dE: 0,
    dN: 0,
    dZ: 0,
    disp2D: 0,
    category: { name: 'Aman', color: '#2ecc71' },
  };
  const transforms = buildMonitoringTransforms([point], {
    scaleH: 100,
    scaleV: 200,
    sphereRadius: 2,
    zCenter: 5,
    zExag: 6,
    showH: true,
    showV: true,
  });

  assert.equal(transforms.sphereRadius, 2);
  assert.deepEqual(transforms.points[0].origin, [10, 20, 35]);
  assert.equal(transforms.points[0].labelZ, 39);
  assert.deepEqual(transforms.points[0].horizontal.direction, [0, 1, 0]);
  assert.equal(transforms.points[0].horizontal.length, 6);
  assert.equal(transforms.points[0].horizontal.headLength, 6 * 0.35);
  assert.equal(transforms.points[0].horizontal.headWidth, 1.6);
  assert.equal(transforms.points[0].vertical, null);
});

test('nonzero horizontal and vertical arrows retain legacy vector formulas', () => {
  const point = {
    id: 'MOVE-01',
    e0: 1,
    n0: 2,
    z0: 3,
    dE: 3,
    dN: 4,
    dZ: -0.1,
    disp2D: 5,
    category: { name: 'Bahaya', color: '#e74c3c' },
  };
  const transforms = buildMonitoringTransforms([point], {
    scaleH: 100,
    scaleV: 200,
    sphereRadius: 2,
    zCenter: 3,
    zExag: 6,
    showH: true,
    showV: true,
  });
  const result = transforms.points[0];

  assert.deepEqual(result.horizontal.direction, [0.6, 0.8, 0]);
  assert.equal(result.horizontal.length, 500);
  assert.equal(result.horizontal.color, '#e74c3c');
  assert.equal(result.horizontal.headLength, 5);
  assert.equal(result.horizontal.headWidth, 2.5);
  assert.deepEqual(result.vertical.direction, [0, 0, -1]);
  assert.equal(result.vertical.length, 20);
  assert.equal(result.vertical.color, 0x1f5f8b);
  assert.equal(result.vertical.headLength, 5);
  assert.equal(result.vertical.headWidth, 2.5);
});
