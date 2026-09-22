import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { DEFAULT_STATE } from '../src/config.js';
import {
  createDataLoader,
  createMeshSettingsFingerprint,
} from '../src/data-loader.js';

const RAW_BYTES = new TextEncoder().encode('canonical weekly DXF bytes');
const STALE_BYTES = new TextEncoder().encode('stale DXF bytes');
const GZIP_BYTES = new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4]);

function copyBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sha256(buffer) {
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}

function fixtureResult() {
  const mesh = {
    x: new Float64Array([0, 1, 0]),
    y: new Float64Array([0, 0, 1]),
    z: new Float64Array([0, 0, 0]),
    i: new Uint32Array([0]),
    j: new Uint32Array([1]),
    k: new Uint32Array([2]),
    stats: { vertexCount: 3, validTriangles: 1 },
  };
  return { rawGeometry: { kind: 'mesh', mesh }, mesh };
}

function manifestFor(bytes = RAW_BYTES) {
  const buffer = copyBuffer(bytes);
  return {
    schemaVersion: 1,
    algorithmVersion: 'dxf-v1',
    dxf: {
      path: 'data/topografi.dxf',
      gzipPath: 'data/topografi.dxf.gz',
      sha256: sha256(buffer),
      bytes: buffer.byteLength,
      gzipBytes: GZIP_BYTES.byteLength,
    },
  };
}

function response({ ok = true, status = 200, json, bytes }) {
  return {
    ok,
    status,
    async json() { return json; },
    async arrayBuffer() { return copyBuffer(bytes); },
  };
}

function fixtureDependencies({
  calls,
  manifest = manifestFor(),
  manifestStatus = 200,
  gzipStatus = 200,
  rawStatus = 200,
  rawBytes = RAW_BYTES,
  decompressedBytes = RAW_BYTES,
  decompressionError = null,
  decompressionSupported = true,
  cacheRecord = null,
  detachManual = false,
} = {}) {
  const cache = {
    async get() {
      calls.push('cache:get');
      return cacheRecord;
    },
    async put(key, record) {
      calls.push('cache:put');
      cache.lastPut = { key, record };
      return true;
    },
  };
  const dxfClient = {
    async parse(buffer) {
      calls.push('worker:parse');
      dxfClient.lastParsedByteLength = buffer.byteLength;
      if (detachManual) structuredClone(buffer, { transfer: [buffer] });
      return fixtureResult();
    },
    async reprocess(rawGeometry) {
      calls.push('worker:reprocess');
      dxfClient.lastRawGeometry = rawGeometry;
      return fixtureResult();
    },
  };
  const fetchFn = async (url, options) => {
    if (url === 'data/assets-manifest.json') {
      calls.push('manifest');
      assert.equal(options.cache, 'no-store');
      return response({
        ok: manifestStatus >= 200 && manifestStatus < 300,
        status: manifestStatus,
        json: manifest,
      });
    }
    if (String(url).startsWith('data/topografi.dxf.gz?v=')) {
      calls.push('gzip');
      return response({
        ok: gzipStatus >= 200 && gzipStatus < 300,
        status: gzipStatus,
        bytes: GZIP_BYTES,
      });
    }
    if (String(url).startsWith('data/topografi.dxf')) {
      calls.push('raw');
      return response({
        ok: rawStatus >= 200 && rawStatus < 300,
        status: rawStatus,
        bytes: rawBytes,
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const decompressGzip = decompressionSupported
    ? async (gzipResponse) => {
        await gzipResponse.arrayBuffer();
        if (decompressionError) throw decompressionError;
        return copyBuffer(decompressedBytes);
      }
    : null;

  return {
    fetchFn,
    cache,
    dxfClient,
    decompressGzip,
    hashBuffer: async (buffer) => sha256(buffer),
    now: () => 1234,
  };
}

test('gzip success verifies bytes, parses once, and caches the result', async () => {
  const calls = [];
  const dependencies = fixtureDependencies({ calls });
  const loader = createDataLoader(dependencies);
  const result = await loader.loadAutoData({ settings: DEFAULT_STATE });

  assert.equal(result.source, 'gzip');
  assert.equal(result.mesh.i.length, 1);
  assert.deepEqual(calls, [
    'manifest',
    'cache:get',
    'gzip',
    'worker:parse',
    'cache:put',
  ]);
  assert.equal(
    dependencies.cache.lastPut.key,
    `${manifestFor().dxf.sha256}:dxf-v1`,
  );
});

test('corrupt gzip falls back to raw DXF', async () => {
  const calls = [];
  const loader = createDataLoader(fixtureDependencies({
    calls,
    decompressionError: new Error('corrupt gzip'),
  }));
  const result = await loader.loadAutoData({ settings: DEFAULT_STATE });

  assert.equal(result.source, 'raw');
  assert.deepEqual(calls, [
    'manifest',
    'cache:get',
    'gzip',
    'raw',
    'worker:parse',
    'cache:put',
  ]);
});

test('missing DecompressionStream skips gzip and uses canonical raw DXF', async () => {
  const calls = [];
  const loader = createDataLoader(fixtureDependencies({
    calls,
    decompressionSupported: false,
  }));
  const result = await loader.loadAutoData({ settings: DEFAULT_STATE });

  assert.equal(result.source, 'raw');
  assert.deepEqual(calls, [
    'manifest',
    'cache:get',
    'raw',
    'worker:parse',
    'cache:put',
  ]);
});

test('matching cache hit requests no DXF asset', async () => {
  const calls = [];
  const cached = fixtureResult();
  const cacheRecord = {
    ...cached,
    meshSettingsFingerprint: createMeshSettingsFingerprint(DEFAULT_STATE),
  };
  const loader = createDataLoader(fixtureDependencies({ calls, cacheRecord }));
  const result = await loader.loadAutoData({ settings: DEFAULT_STATE });

  assert.equal(result.source, 'cache');
  assert.equal(result.mesh, cached.mesh);
  assert.deepEqual(calls, ['manifest', 'cache:get']);
});

test('cache settings mismatch reprocesses raw geometry without downloading', async () => {
  const calls = [];
  const cached = fixtureResult();
  const cacheRecord = {
    ...cached,
    meshSettingsFingerprint: 'different-settings',
    sourceBytes: RAW_BYTES.byteLength,
  };
  const dependencies = fixtureDependencies({ calls, cacheRecord });
  const loader = createDataLoader(dependencies);
  const result = await loader.loadAutoData({ settings: DEFAULT_STATE });

  assert.equal(result.source, 'cache-reprocessed');
  assert.equal(dependencies.dxfClient.lastRawGeometry, cached.rawGeometry);
  assert.deepEqual(calls, [
    'manifest',
    'cache:get',
    'worker:reprocess',
    'cache:put',
  ]);
});

test('manifest failure falls back to unversioned canonical raw DXF', async () => {
  const calls = [];
  const loader = createDataLoader(fixtureDependencies({
    calls,
    manifestStatus: 404,
  }));
  const result = await loader.loadAutoData({ settings: DEFAULT_STATE });

  assert.equal(result.source, 'raw');
  assert.equal(result.sourceHash, manifestFor().dxf.sha256);
  assert.deepEqual(calls, ['manifest', 'raw', 'worker:parse']);
});

test('hash-mismatched gzip falls back but mismatched raw fails before parsing', async () => {
  const fallbackCalls = [];
  const fallbackLoader = createDataLoader(fixtureDependencies({
    calls: fallbackCalls,
    decompressedBytes: STALE_BYTES,
  }));
  assert.equal(
    (await fallbackLoader.loadAutoData({ settings: DEFAULT_STATE })).source,
    'raw',
  );
  assert.deepEqual(fallbackCalls, [
    'manifest',
    'cache:get',
    'gzip',
    'raw',
    'worker:parse',
    'cache:put',
  ]);

  const failureCalls = [];
  const failingLoader = createDataLoader(fixtureDependencies({
    calls: failureCalls,
    decompressionError: new Error('corrupt'),
    rawBytes: STALE_BYTES,
  }));
  await assert.rejects(
    failingLoader.loadAutoData({ settings: DEFAULT_STATE }),
    (error) => error.name === 'DataLoadError'
      && error.stage === 'raw'
      && error.manualRequired === true,
  );
  assert.deepEqual(failureCalls, [
    'manifest',
    'cache:get',
    'gzip',
    'raw',
  ]);
});

test('raw 404 produces a typed manual-mode error', async () => {
  const calls = [];
  const loader = createDataLoader(fixtureDependencies({
    calls,
    decompressionError: new Error('corrupt'),
    rawStatus: 404,
  }));

  await assert.rejects(
    loader.loadAutoData({ settings: DEFAULT_STATE }),
    (error) => error.name === 'DataLoadError'
      && error.stage === 'raw'
      && error.manualRequired === true,
  );
  assert.deepEqual(calls, ['manifest', 'cache:get', 'gzip', 'raw']);
});

test('abort is preserved and does not enter fallback paths', async () => {
  const calls = [];
  const controller = new AbortController();
  controller.abort();
  const loader = createDataLoader(fixtureDependencies({ calls }));

  await assert.rejects(
    loader.loadAutoData({ settings: DEFAULT_STATE, signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
  assert.deepEqual(calls, []);
});

test('manual buffer is cached only when it matches the known manifest', async () => {
  const matchingCalls = [];
  const matchingDependencies = fixtureDependencies({
    calls: matchingCalls,
    detachManual: true,
  });
  const matchingLoader = createDataLoader(matchingDependencies);
  const matchingBuffer = copyBuffer(RAW_BYTES);
  const matching = await matchingLoader.loadManualDxf({
    buffer: matchingBuffer,
    settings: DEFAULT_STATE,
    manifest: manifestFor(),
  });

  assert.equal(matching.source, 'manual');
  assert.equal(matching.cacheStored, true);
  assert.equal(matchingBuffer.byteLength, 0);
  assert.deepEqual(matchingCalls, ['worker:parse', 'cache:put']);

  const otherCalls = [];
  const otherLoader = createDataLoader(fixtureDependencies({
    calls: otherCalls,
    detachManual: true,
  }));
  const other = await otherLoader.loadManualDxf({
    buffer: copyBuffer(STALE_BYTES),
    settings: DEFAULT_STATE,
    manifest: manifestFor(),
  });
  assert.equal(other.cacheStored, false);
  assert.deepEqual(otherCalls, ['worker:parse']);
});

test('mesh settings fingerprint ignores visual-only controls', () => {
  const changedVisuals = {
    ...DEFAULT_STATE,
    opacity: 0.2,
    colorByElev: false,
    showLabels: true,
  };
  assert.equal(
    createMeshSettingsFingerprint(changedVisuals),
    createMeshSettingsFingerprint(DEFAULT_STATE),
  );
  assert.notEqual(
    createMeshSettingsFingerprint({ ...DEFAULT_STATE, voxelSize: 5 }),
    createMeshSettingsFingerprint(DEFAULT_STATE),
  );
});
