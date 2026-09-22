import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyExtractDxf,
  loadLegacyDependencies,
} from './helpers/legacy-reference.mjs';
import { parseDxfGeometry, validateMesh } from '../src/dxf-core.js';
import { geometryDigest } from './helpers/geometry-digest.mjs';
import { readProductionDxf } from './helpers/production-dxf.mjs';

test('current canonical DXF remains valid and matches the legacy reference', async () => {
  const text = await readProductionDxf('utf8');
  const dependencies = await loadLegacyDependencies();
  const legacy = legacyExtractDxf(text, dependencies);
  const optimized = parseDxfGeometry(text, dependencies);

  assert.ok(text.trim().length > 0);
  assert.equal(optimized.kind, legacy.kind);
  assert.equal(optimized.kind, 'mesh');
  assert.equal(validateMesh(optimized.mesh), true);
  assert.ok(optimized.mesh.x.length > 0);
  assert.ok(optimized.mesh.i.length > 0);
  assert.equal(geometryDigest(optimized.mesh), geometryDigest(legacy.mesh));
});
