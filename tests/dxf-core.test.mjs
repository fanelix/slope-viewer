import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildMeshFromGeometry,
  parseDxfGeometry,
  validateMesh,
} from '../src/dxf-core.js';
import { geometryDigest } from './helpers/geometry-digest.mjs';
import {
  legacyExtractDxf,
  loadLegacyDependencies,
} from './helpers/legacy-reference.mjs';
import { readProductionDxf } from './helpers/production-dxf.mjs';

const DEFAULT_MESH_SETTINGS = Object.freeze({
  voxelSize: 2,
  preserveEdges: true,
  maxSlopeDeg: 90,
  maxEdgeLen: 1e9,
  edgeMultiplier: 4,
});

async function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

test('optimized extraction is byte-equivalent to the legacy reference', async () => {
  const text = await readProductionDxf('utf8');
  const dependencies = await loadLegacyDependencies();
  const legacy = legacyExtractDxf(text, dependencies);
  const optimized = parseDxfGeometry(text, dependencies);

  assert.equal(optimized.kind, legacy.kind);
  assert.equal(geometryDigest(optimized.mesh), geometryDigest(legacy.mesh));
  assert.deepEqual(optimized.mesh.stats, legacy.mesh.stats);
  assert.equal(validateMesh(optimized.mesh), true);
});

test('valid replacement DXF may change counts while both extractors agree', async () => {
  const text = await read('./fixtures/terrain-sample.dxf');
  const dependencies = await loadLegacyDependencies();
  const legacy = legacyExtractDxf(text, dependencies);
  const optimized = parseDxfGeometry(text, dependencies);

  assert.equal(geometryDigest(optimized.mesh), geometryDigest(legacy.mesh));
  assert.equal(
    geometryDigest(optimized.mesh),
    '84dd01dc560fa3df5c02c0ee3e184145578e113ff7778476b0ad9818aefb4e88',
  );
  assert.equal(validateMesh(optimized.mesh), true);
});

test('default mesh build preserves an extracted direct mesh exactly', async () => {
  const text = await read('./fixtures/terrain-sample.dxf');
  const dependencies = await loadLegacyDependencies();
  const geometry = parseDxfGeometry(text, dependencies);
  const mesh = buildMeshFromGeometry(
    geometry,
    DEFAULT_MESH_SETTINGS,
    dependencies,
  );

  assert.equal(geometryDigest(mesh), geometryDigest(geometry.mesh));
  assert.equal(validateMesh(mesh), true);
});

test('mesh validation rejects malformed or non-finite geometry', () => {
  const valid = {
    x: new Float64Array([0, 1, 0]),
    y: new Float64Array([0, 0, 1]),
    z: new Float64Array([0, 0, 0]),
    i: new Uint32Array([0]),
    j: new Uint32Array([1]),
    k: new Uint32Array([2]),
  };

  assert.equal(validateMesh(valid), true);
  assert.equal(validateMesh({ ...valid, z: new Float64Array([0, NaN, 0]) }), false);
  assert.equal(validateMesh({ ...valid, k: new Uint32Array([3]) }), false);
  assert.equal(validateMesh({ ...valid, j: new Uint32Array() }), false);
});
