import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parse3dFaceStream } from '../src/dxf-3dface-stream.js';
import { parseDxfGeometry } from '../src/dxf-core.js';
import { geometryDigest } from './helpers/geometry-digest.mjs';
import {
  legacyExtractDxf,
  loadLegacyDependencies,
} from './helpers/legacy-reference.mjs';
import { readProductionDxf } from './helpers/production-dxf.mjs';

const execFileAsync = promisify(execFile);

const POLYLINE_FIXTURE = `0
SECTION
2
ENTITIES
0
LWPOLYLINE
90
2
10
0
20
0
10
1
20
1
0
ENDSEC
0
EOF
`;

const MIXED_FACE_FIXTURE = `0
SECTION
2
ENTITIES
0
INSERT
2
SURVEY_BLOCK
10
7
20
8
0
3DFACE
10
0
20
0
11
1
21
0
12
1
22
1
13
0
23
1
0
3DFACE
10
2
20
0
11
3
21
0
12
2
22
1
13
2
23
1
0
ENDSEC
0
EOF
`;

const MALFORMED_FACE_FIXTURE = `0
SECTION
2
ENTITIES
0
3DFACE
10
0
20
`;

test('streaming parser exactly matches the canonical legacy geometry', async () => {
  const text = await readProductionDxf('utf8');
  const dependencies = await loadLegacyDependencies();
  const streamed = parse3dFaceStream(text);
  const legacy = legacyExtractDxf(text, dependencies);

  assert.equal(streamed.supported, true);
  assert.equal(geometryDigest(streamed.mesh), geometryDigest(legacy.mesh));
  assert.deepEqual(streamed.mesh.stats, legacy.mesh.stats);
  assert.deepEqual(streamed.typeCount, legacy.typeCount);
});

test('unsupported non-3DFACE geometry requests general-parser fallback', () => {
  assert.deepEqual(parse3dFaceStream(POLYLINE_FIXTURE), {
    supported: false,
    reason: 'unsupported-entity',
  });
});

test('mixed INSERT and 3DFACE input preserves missing-Z and quad rules', () => {
  const streamed = parse3dFaceStream(MIXED_FACE_FIXTURE);

  assert.equal(streamed.supported, true);
  assert.deepEqual(streamed.typeCount, { INSERT: 1, '3DFACE': 2 });
  assert.deepEqual(Array.from(streamed.mesh.x), [0, 1, 1, 0, 2, 3, 2]);
  assert.deepEqual(Array.from(streamed.mesh.y), [0, 0, 1, 1, 0, 0, 1]);
  assert.deepEqual(Array.from(streamed.mesh.z), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(streamed.mesh.i), [0, 0, 4]);
  assert.deepEqual(Array.from(streamed.mesh.j), [1, 2, 5]);
  assert.deepEqual(Array.from(streamed.mesh.k), [2, 3, 6]);
  assert.deepEqual(streamed.mesh.stats, {
    vertexCount: 7,
    validTriangles: 3,
    source: '3DFACE direct',
    quadSplit: 1,
    skipped: 0,
  });
});

test('malformed group pairs request safe general-parser fallback', () => {
  assert.deepEqual(parse3dFaceStream(MALFORMED_FACE_FIXTURE), {
    supported: false,
    reason: 'malformed-dxf',
  });
});

test('production parsing selects streaming for a supported 3DFACE layout', () => {
  class GeneralParserMustNotRun {
    constructor() {
      throw new Error('general parser was constructed');
    }
  }

  const parsed = parseDxfGeometry(MIXED_FACE_FIXTURE, {
    DxfParser: GeneralParserMustNotRun,
  });

  assert.equal(parsed.kind, 'mesh');
  assert.deepEqual(Array.from(parsed.mesh.i), [0, 0, 4]);
  assert.deepEqual(parsed.typeCount, { INSERT: 1, '3DFACE': 2 });
});

test('production parsing falls back for unsupported non-3DFACE geometry', async () => {
  const dependencies = await loadLegacyDependencies();
  const parsed = parseDxfGeometry(POLYLINE_FIXTURE, dependencies);

  assert.equal(parsed.kind, 'points');
  assert.deepEqual(Array.from(parsed.points), [0, 0, 0, 1, 1, 0]);
  assert.deepEqual(parsed.typeCount, { LWPOLYLINE: 1 });
});

test('benchmark isolates both parsers and reports equivalent geometry', async () => {
  const repositoryRoot = new URL('..', import.meta.url);
  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/benchmark-dxf.mjs', 'tests/fixtures/terrain-sample.dxf'],
    { cwd: repositoryRoot, maxBuffer: 1024 * 1024 },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.equivalent, true);
  assert.equal(report.general.digest, report.streaming.digest);
  assert.equal(
    report.general.digest,
    '84dd01dc560fa3df5c02c0ee3e184145578e113ff7778476b0ad9818aefb4e88',
  );
  for (const result of [report.general, report.streaming]) {
    assert.equal(result.vertexCount, 8);
    assert.equal(result.triangleCount, 6);
    assert.equal(Number.isFinite(result.parseMilliseconds), true);
    assert.equal(result.parseMilliseconds >= 0, true);
    assert.equal(result.peakHeapBytes > 0, true);
    assert.equal(result.peakRssBytes > 0, true);
    assert.equal(result.heapDeltaBytes >= 0, true);
  }
});
