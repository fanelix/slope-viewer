import { validateMesh } from './dxf-core.js';

const DEFAULT_TIMEOUT_MS = 120_000;

function defaultWorkerFactory() {
  return new Worker(
    new URL('./workers/dxf-worker.js', import.meta.url),
    { type: 'module' },
  );
}

export function collectTransferables(...values) {
  const buffers = new Set();
  const visited = new WeakSet();
  const visit = (value) => {
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
      return;
    }
    if (value instanceof ArrayBuffer) {
      buffers.add(value);
      return;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    for (const nested of Object.values(value)) visit(nested);
  };
  for (const value of values) visit(value);
  return [...buffers].filter((buffer) => buffer.byteLength > 0);
}

function clonePayloadForWorker(operation, payload) {
  if (operation === 'parse') return payload.slice(0);
  if (payload.kind === 'points') {
    return {
      ...payload,
      points: payload.points.slice(),
      typeCount: payload.typeCount ? { ...payload.typeCount } : undefined,
    };
  }
  const mesh = payload.mesh;
  return {
    ...payload,
    typeCount: payload.typeCount ? { ...payload.typeCount } : undefined,
    mesh: {
      ...mesh,
      x: mesh.x.slice(),
      y: mesh.y.slice(),
      z: mesh.z.slice(),
      i: mesh.i.slice(),
      j: mesh.j.slice(),
      k: mesh.k.slice(),
      stats: mesh.stats ? { ...mesh.stats } : undefined,
    },
  };
}

export function validateRawGeometry(rawGeometry) {
  if (!rawGeometry || typeof rawGeometry !== 'object') return false;
  if (rawGeometry.kind === 'mesh') {
    return validateMesh(rawGeometry.mesh);
  }
  if (rawGeometry.kind !== 'points') return false;
  if (
    !(rawGeometry.points instanceof Float64Array)
    || rawGeometry.points.length === 0
    || rawGeometry.points.length % 3 !== 0
  ) {
    return false;
  }
  for (const value of rawGeometry.points) {
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

function validateResult(result, source) {
  if (
    !result
    || !validateRawGeometry(result.rawGeometry)
    || !validateMesh(result.mesh)
  ) {
    throw new Error(`${source} produced invalid geometry`);
  }
  return result;
}

function workerError(message, stage) {
  const error = new Error(stage ? `${stage}: ${message}` : message);
  error.name = 'DxfWorkerError';
  error.stage = stage;
  return error;
}

export function createDxfClient({
  workerFactory = defaultWorkerFactory,
  syncParser,
  onProgress = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let nextRequestId = 1;
  let active = null;

  const clearActive = (request) => {
    if (active === request) active = null;
  };

  const runSynchronously = (request, payload, settings, cause) => {
    if (typeof syncParser !== 'function') {
      clearActive(request);
      return Promise.reject(workerError(
        `Worker unavailable and no synchronous parser is configured: ${cause.message}`,
        request.operation,
      ));
    }

    try {
      onProgress({
        id: request.id,
        type: 'progress',
        stage: 'sync-fallback',
      });
    } catch {
      // Progress reporting must never turn a compatible fallback into a failure.
    }

    return Promise.resolve()
      .then(() => syncParser(payload, settings, request.operation))
      .then((result) => validateResult(result, 'Synchronous parser'))
      .finally(() => clearActive(request));
  };

  const start = (operation, payload, settings) => {
    if (active) {
      return Promise.reject(new Error(
        `A DXF request is already active (${active.id})`,
      ));
    }

    const request = {
      id: `dxf-${nextRequestId}`,
      operation,
      worker: null,
      reject: null,
      timer: null,
      settled: false,
    };
    nextRequestId += 1;
    active = request;

    let worker;
    try {
      worker = workerFactory({ id: request.id, operation });
      if (!worker || typeof worker.postMessage !== 'function') {
        throw new TypeError('workerFactory did not return a Worker');
      }
    } catch (error) {
      return runSynchronously(request, payload, settings, error);
    }
    request.worker = worker;

    let workerPayload;
    try {
      // Keep the caller-owned payload intact until the worker succeeds. Module
      // workers can construct successfully and still fail while loading or
      // parsing, after the posted payload has already been detached.
      workerPayload = clonePayloadForWorker(operation, payload);
    } catch (error) {
      worker.terminate();
      request.worker = null;
      return runSynchronously(request, payload, settings, error);
    }

    const promise = new Promise((resolve, reject) => {
      request.reject = reject;
      const stopWorker = () => {
        if (request.timer != null) clearTimeout(request.timer);
        request.timer = null;
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        if (request.worker) {
          request.worker.terminate();
          request.worker = null;
        }
      };
      const finish = (callback, value) => {
        if (request.settled) return;
        request.settled = true;
        stopWorker();
        clearActive(request);
        callback(value);
      };
      const recoverSynchronously = (cause) => {
        if (request.settled) return;
        request.settled = true;
        stopWorker();
        request.settled = false;
        runSynchronously(request, payload, settings, cause).then(resolve, reject);
      };

      worker.onmessage = (event) => {
        const message = event.data;
        if (!message || message.id !== request.id) return;
        if (message.type === 'progress') {
          try {
            onProgress(message);
          } catch {
            // Progress callbacks are observational and cannot fail parsing.
          }
          return;
        }
        if (message.type === 'error') {
          finish(
            reject,
            workerError(
              message.message || 'Unknown worker error',
              message.stage || operation,
            ),
          );
          return;
        }
        if (message.type !== 'success') return;
        try {
          finish(resolve, validateResult(message, 'Worker'));
        } catch (error) {
          recoverSynchronously(error);
        }
      };

      worker.onerror = (event) => {
        event.preventDefault?.();
        recoverSynchronously(
          workerError(
            event.error?.message || event.message || 'Worker failed',
            operation,
          ),
        );
      };
      worker.onmessageerror = () => {
        recoverSynchronously(
          workerError('Worker response could not be decoded', operation),
        );
      };

      request.timer = setTimeout(() => {
        recoverSynchronously(
          workerError(`DXF worker timed out after ${timeoutMs} ms`, operation),
        );
      }, timeoutMs);

      const message = operation === 'parse'
        ? { id: request.id, operation, buffer: workerPayload, settings }
        : { id: request.id, operation, rawGeometry: workerPayload, settings };
      const transfer = operation === 'parse'
        ? [workerPayload]
        : collectTransferables(workerPayload);
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        recoverSynchronously(error);
      }
    });

    return promise;
  };

  return {
    parse(buffer, settings) {
      if (!(buffer instanceof ArrayBuffer)) {
        return Promise.reject(new TypeError('DXF source must be an ArrayBuffer'));
      }
      return start('parse', buffer, settings);
    },

    reprocess(rawGeometry, settings) {
      if (!validateRawGeometry(rawGeometry)) {
        return Promise.reject(new TypeError('Raw DXF geometry is invalid'));
      }
      return start('reprocess', rawGeometry, settings);
    },

    dispose() {
      if (!active) return;
      const request = active;
      request.settled = true;
      if (request.timer != null) clearTimeout(request.timer);
      if (request.worker) {
        request.worker.onmessage = null;
        request.worker.onerror = null;
        request.worker.onmessageerror = null;
        request.worker.terminate();
      }
      clearActive(request);
      request.reject?.(workerError('DXF client disposed', request.operation));
    },
  };
}
