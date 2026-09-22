import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  legacyExtractDxf,
  loadLegacyDependencies,
} from './helpers/legacy-reference.mjs';
import { geometryDigest } from './helpers/geometry-digest.mjs';

test('canonical DXF establishes the immutable refactor baseline', async () => {
  const text = await readFile(
    new URL('../data/topografi.dxf', import.meta.url),
    'utf8',
  );
  const dependencies = await loadLegacyDependencies();
  const geometry = legacyExtractDxf(text, dependencies);

  assert.equal(geometry.mesh.x.length, 21_002);
  assert.equal(geometry.mesh.i.length, 41_832);
  assert.equal(
    geometryDigest(geometry.mesh),
    '8fd2580cef69c33fb15a5035a9e2b7308c0617ea5e1b35357636514c11e21a3b',
  );
  assert.deepEqual(geometry.bbox, {
    minX: 174463.74700927734,
    maxX: 177063.76000976562,
    minY: 9046593.924377441,
    maxY: 9048189.697998047,
    minZ: 8.487126350402832,
    maxZ: 374.9599914550781,
  });
});
