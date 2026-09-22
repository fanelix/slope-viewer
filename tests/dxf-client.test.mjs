import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_STATE } from '../src/config.js';
import { createDxfClient } from '../src/dxf-client.js';

class FakeWorker {
  constructor() {
    this.messages = [];
    this.transferCounts = [];
    this.terminateCount = 0;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  postMessage(message, transfer = []) {
    this.transferCounts.push(new Set(transfer).size);
    this.messages.push(structuredClone(message, { transfer }));
  }

  respond(type, payload = {}, id = this.messages.at(-1)?.id) {
    this.onmessage?.({ data: { id, type, ...payload } });
  }

  respondSuccess(result, id) {
    this.respond('success', result, id);
  }

  fail(error = new Error('worker crashed')) {
    this.onerror?.({ error, message: error.message });
  }

  terminate() {
    this.terminateCount += 1;
  }
}

function validFixtureResult() {
  const mesh = {
    x: new Float64Array([0, 10, 10, 0, 0, 10, 10, 0]),
    y: new Float64Array([0, 0, 10, 10, 0, 0, 10, 10]),
    z: new Float64Array([0, 0, 0, 0, 5, 5, 5, 5]),
    i: new Uint32Array([0, 0, 4, 4, 0, 0]),
    j: new Uint32Array([1, 2, 6, 7, 1, 5]),
    k: new Uint32Array([2, 3, 5, 6, 5, 4]),
    stats: { vertexCount: 8, validTriangles: 6 },
  };
  return { rawGeometry: { kind: 'mesh', mesh }, mesh };
}

function fixtureBuffer() {
  return new TextEncoder().encode('fixture DXF').buffer;
}

function failIfCalled() {
  throw new Error('synchronous parser must not be called');
}

test('client resolves a matching response and transfers an isolated source copy', async () => {
  const worker = new FakeWorker();
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: failIfCalled,
  });
  const source = fixtureBuffer();
  const pending = client.parse(source, DEFAULT_STATE);

  assert.ok(source.byteLength > 0);
  assert.equal(worker.messages[0].operation, 'parse');
  assert.equal(worker.transferCounts[0], 1);
  worker.respondSuccess(validFixtureResult());

  const result = await pending;
  assert.equal(result.mesh.i.length, 6);
  assert.equal(result.rawGeometry.mesh.x.byteLength, 64);
  assert.equal(worker.terminateCount, 1);
});

test('worker creation failure uses the synchronous compatibility path', async () => {
  const source = fixtureBuffer();
  let receivedBuffer;
  const client = createDxfClient({
    workerFactory: () => {
      throw new Error('worker unavailable');
    },
    syncParser: (buffer) => {
      receivedBuffer = buffer;
      return validFixtureResult();
    },
  });

  const result = await client.parse(source, DEFAULT_STATE);
  assert.equal(receivedBuffer, source);
  assert.ok(source.byteLength > 0);
  assert.equal(result.mesh.i.length, 6);
});

test('mismatched worker responses are ignored until the request ID matches', async () => {
  const worker = new FakeWorker();
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: failIfCalled,
  });
  const pending = client.parse(fixtureBuffer(), DEFAULT_STATE);
  const requestId = worker.messages[0].id;

  worker.respondSuccess(validFixtureResult(), `${requestId}-stale`);
  assert.equal(worker.terminateCount, 0);
  worker.respondSuccess(validFixtureResult(), requestId);

  assert.equal((await pending).mesh.i.length, 6);
  assert.equal(worker.terminateCount, 1);
});

test('progress is forwarded only for the active request', async () => {
  const worker = new FakeWorker();
  const progress = [];
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: failIfCalled,
    onProgress: (value) => progress.push(value),
  });
  const pending = client.parse(fixtureBuffer(), DEFAULT_STATE);
  const requestId = worker.messages[0].id;

  worker.respond('progress', { stage: 'extract' }, 'stale');
  worker.respond('progress', { stage: 'extract' }, requestId);
  worker.respondSuccess(validFixtureResult(), requestId);
  await pending;

  assert.deepEqual(progress, [{ id: requestId, type: 'progress', stage: 'extract' }]);
});

test('worker-reported error rejects and always terminates the worker', async () => {
  const worker = new FakeWorker();
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: failIfCalled,
  });
  const pending = client.parse(fixtureBuffer(), DEFAULT_STATE);

  worker.respond('error', { stage: 'parse', message: 'invalid DXF' });
  await assert.rejects(pending, /parse: invalid DXF/);
  assert.equal(worker.terminateCount, 1);
});

test('asynchronous worker startup failure retries synchronously with intact source', async () => {
  const worker = new FakeWorker();
  let syncCalls = 0;
  let fallbackSource;
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: (source) => {
      syncCalls += 1;
      fallbackSource = source;
      return validFixtureResult();
    },
  });
  const source = fixtureBuffer();
  const pending = client.parse(source, DEFAULT_STATE);
  worker.fail(new Error('worker crashed'));

  assert.equal((await pending).mesh.i.length, 6);
  assert.equal(source.byteLength, new TextEncoder().encode('fixture DXF').byteLength);
  assert.equal(fallbackSource, source);
  assert.equal(syncCalls, 1);
  assert.equal(worker.terminateCount, 1);
});

test('worker timeout retries synchronously and terminates the worker', async () => {
  const worker = new FakeWorker();
  let syncCalls = 0;
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: () => {
      syncCalls += 1;
      return validFixtureResult();
    },
    timeoutMs: 5,
  });

  const result = await client.parse(fixtureBuffer(), DEFAULT_STATE);
  assert.equal(result.mesh.i.length, 6);
  assert.equal(syncCalls, 1);
  assert.equal(worker.terminateCount, 1);
});

test('undecodable worker response retries synchronously', async () => {
  const worker = new FakeWorker();
  let syncCalls = 0;
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: () => {
      syncCalls += 1;
      return validFixtureResult();
    },
  });

  const pending = client.parse(fixtureBuffer(), DEFAULT_STATE);
  worker.onmessageerror?.({});

  assert.equal((await pending).mesh.i.length, 6);
  assert.equal(syncCalls, 1);
  assert.equal(worker.terminateCount, 1);
});

test('asynchronous reprocess failure preserves raw geometry for sync recovery', async () => {
  const worker = new FakeWorker();
  const rawGeometry = validFixtureResult().rawGeometry;
  let fallbackGeometry;
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: (payload) => {
      fallbackGeometry = payload;
      return { rawGeometry: payload, mesh: payload.mesh };
    },
  });

  const pending = client.reprocess(rawGeometry, DEFAULT_STATE);
  worker.fail(new Error('module worker failed after construction'));
  const result = await pending;

  assert.equal(fallbackGeometry, rawGeometry);
  assert.equal(rawGeometry.mesh.x.byteLength, 64);
  assert.equal(result.mesh.i.length, 6);
  assert.equal(worker.terminateCount, 1);
});

test('shared raw and mesh buffers are transferred once and remain reprocessable', async () => {
  const parseWorker = new FakeWorker();
  const reprocessWorker = new FakeWorker();
  const workers = [parseWorker, reprocessWorker];
  const client = createDxfClient({
    workerFactory: () => workers.shift(),
    syncParser: failIfCalled,
  });

  const firstPending = client.parse(fixtureBuffer(), DEFAULT_STATE);
  parseWorker.respondSuccess(validFixtureResult());
  const first = await firstPending;
  const reprocessPending = client.reprocess(first.rawGeometry, DEFAULT_STATE);

  assert.equal(reprocessWorker.transferCounts[0], 6);
  assert.equal(first.rawGeometry.mesh.x.byteLength, 64);
  const workerRaw = reprocessWorker.messages[0].rawGeometry;
  reprocessWorker.respondSuccess({ rawGeometry: workerRaw, mesh: workerRaw.mesh });
  const second = await reprocessPending;

  assert.equal(second.mesh.i.length, 6);
  assert.equal(second.rawGeometry.mesh.x.byteLength, 64);
});

test('a second heavy request is rejected while one is active', async () => {
  const worker = new FakeWorker();
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: failIfCalled,
  });
  const first = client.parse(fixtureBuffer(), DEFAULT_STATE);

  await assert.rejects(
    client.parse(fixtureBuffer(), DEFAULT_STATE),
    /already active/i,
  );
  worker.respondSuccess(validFixtureResult());
  await first;
});

test('dispose rejects the active request and removes worker handlers', async () => {
  const worker = new FakeWorker();
  const client = createDxfClient({
    workerFactory: () => worker,
    syncParser: failIfCalled,
  });
  const pending = client.parse(fixtureBuffer(), DEFAULT_STATE);

  client.dispose();

  await assert.rejects(pending, /disposed/i);
  assert.equal(worker.terminateCount, 1);
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.equal(worker.onmessageerror, null);
});
