import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCacheKey,
  createIndexedDbBackend,
  createMeshCache,
} from '../src/cache.js';

class MemoryCacheBackend {
  constructor(entries = {}) {
    this.records = new Map(Object.entries(entries));
    this.deleted = [];
    this.deleteExceptCalls = [];
  }

  get(key) {
    return this.records.get(key);
  }

  put(key, record) {
    this.records.set(key, record);
  }

  delete(key) {
    this.deleted.push(key);
    this.records.delete(key);
  }

  deleteExcept(key) {
    this.deleteExceptCalls.push(key);
    for (const existingKey of this.records.keys()) {
      if (existingKey !== key) this.records.delete(existingKey);
    }
  }

  has(key) {
    return this.records.has(key);
  }
}

function validRecord(overrides = {}) {
  const mesh = {
    x: new Float64Array([0, 1, 0]),
    y: new Float64Array([0, 0, 1]),
    z: new Float64Array([0, 0, 0]),
    i: new Uint32Array([0]),
    j: new Uint32Array([1]),
    k: new Uint32Array([2]),
    stats: { vertexCount: 3, validTriangles: 1 },
  };
  return {
    key: 'abc:dxf-v1',
    sourceHash: 'abc',
    algorithmVersion: 'dxf-v1',
    rawGeometry: { kind: 'mesh', mesh },
    mesh,
    meshSettingsFingerprint: 'settings-v1',
    createdAt: 1,
    sourceBytes: 100,
    ...overrides,
  };
}

test('cache key includes source hash and algorithm version', () => {
  assert.equal(createCacheKey('abc123', 'dxf-v1'), 'abc123:dxf-v1');
});

test('valid cache records are returned intact', async () => {
  const record = validRecord();
  const backend = new MemoryCacheBackend({ [record.key]: record });
  const cache = createMeshCache({ backend });

  assert.equal(await cache.get(record.key), record);
  assert.deepEqual(backend.deleted, []);
});

test('malformed cache records are rejected and deleted', async () => {
  const key = 'abc:dxf-v1';
  const malformed = validRecord({
    mesh: {
      x: [NaN],
      y: [0],
      z: [0],
      i: [0],
      j: [0],
      k: [0],
    },
  });
  const backend = new MemoryCacheBackend({ [key]: malformed });
  const cache = createMeshCache({ backend });

  assert.equal(await cache.get(key), null);
  assert.equal(backend.has(key), false);
  assert.deepEqual(backend.deleted, [key]);
});

test('cache records must match the requested source and algorithm key', async () => {
  const key = 'abc:dxf-v1';
  const backend = new MemoryCacheBackend({
    [key]: validRecord({ sourceHash: 'different' }),
  });
  const cache = createMeshCache({ backend });

  assert.equal(await cache.get(key), null);
  assert.equal(backend.has(key), false);
});

test('cache validates mesh statistics and point-based raw geometry', async () => {
  const key = 'abc:dxf-v1';
  const pointRecord = validRecord({
    rawGeometry: {
      kind: 'points',
      points: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    },
  });
  const backend = new MemoryCacheBackend({ [key]: pointRecord });
  const cache = createMeshCache({ backend });

  assert.equal(await cache.get(key), pointRecord);

  const invalidStats = validRecord();
  invalidStats.mesh = {
    ...invalidStats.mesh,
    stats: { vertexCount: 99, validTriangles: 1 },
  };
  backend.records.set(key, invalidStats);
  assert.equal(await cache.get(key), null);
});

test('cache writes only valid records and prunes stale entries', async () => {
  const backend = new MemoryCacheBackend({ stale: validRecord() });
  const cache = createMeshCache({ backend });
  const record = validRecord();

  assert.equal(await cache.put(record.key, record), true);
  assert.equal(backend.has(record.key), true);
  assert.equal(backend.has('stale'), false);
  assert.deepEqual(backend.deleteExceptCalls, [record.key]);
  assert.equal(await cache.put('bad:dxf-v1', { mesh: null }), false);
  assert.equal(backend.has('bad:dxf-v1'), false);
});

test('backend failures disable cache without failing the load path', async () => {
  const backend = {
    async get() { throw new Error('blocked'); },
    async put() { throw new Error('quota'); },
    async delete() { throw new Error('blocked'); },
    async deleteExcept() { throw new Error('blocked'); },
  };
  const cache = createMeshCache({ backend });

  assert.equal(await cache.get('abc:dxf-v1'), null);
  assert.equal(await cache.put('abc:dxf-v1', validRecord()), false);
});

test('unsupported IndexedDB reports operation failures through promises', async () => {
  const backend = createIndexedDbBackend({ indexedDB: null });

  await assert.rejects(backend.get('key'), /IndexedDB/i);
  await assert.rejects(backend.put('key', {}), /IndexedDB/i);
});
