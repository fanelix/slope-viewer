import {
  ALGORITHM_VERSION,
  AUTO_LOAD_PATHS,
} from './config.js';
import {
  createCacheKey,
  createIndexedDbBackend,
  createMeshCache,
} from './cache.js';

const NOOP_CACHE = Object.freeze({
  async get() { return null; },
  async put() { return false; },
});

export class DataLoadError extends Error {
  constructor(message, { stage, cause, manualRequired = true } = {}) {
    super(message);
    this.name = 'DataLoadError';
    this.stage = stage;
    this.cause = cause;
    this.manualRequired = manualRequired;
  }
}

export function createMeshSettingsFingerprint(settings) {
  return JSON.stringify([
    ['voxelSize', Number(settings.voxelSize)],
    ['preserveEdges', Boolean(settings.preserveEdges)],
    ['maxSlopeDeg', Number(settings.maxSlopeDeg)],
    ['maxEdgeLen', Number(settings.maxEdgeLen)],
    ['edgeMultiplier', Number(settings.edgeMultiplier)],
  ]);
}

function isAbort(error, signal) {
  return signal?.aborted || error?.name === 'AbortError';
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  throw error;
}

function validateManifest(value) {
  return Boolean(
    value
    && value.schemaVersion === 1
    && value.algorithmVersion === ALGORITHM_VERSION
    && value.dxf
    && typeof value.dxf.path === 'string'
    && value.dxf.path.length > 0
    && typeof value.dxf.gzipPath === 'string'
    && value.dxf.gzipPath.length > 0
    && typeof value.dxf.sha256 === 'string'
    && /^[a-f\d]{64}$/i.test(value.dxf.sha256)
    && Number.isInteger(value.dxf.bytes)
    && value.dxf.bytes > 0
    && Number.isInteger(value.dxf.gzipBytes)
    && value.dxf.gzipBytes > 0,
  );
}

function versionedPath(path, hash) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}v=${hash.slice(0, 12)}`;
}

async function defaultHashBuffer(buffer) {
  if (!globalThis.crypto?.subtle?.digest) return null;
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', buffer),
  );
  return [...digest]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function createDefaultDecompressor() {
  if (
    typeof globalThis.DecompressionStream !== 'function'
    || typeof globalThis.Response !== 'function'
  ) {
    return null;
  }
  return async (response) => {
    const blob = await response.blob();
    const decompressed = blob.stream().pipeThrough(
      new globalThis.DecompressionStream('gzip'),
    );
    return new globalThis.Response(decompressed).arrayBuffer();
  };
}

export function createDataLoader(dependencies = {}) {
  const {
    fetchFn = globalThis.fetch?.bind(globalThis),
    dxfClient,
    hashBuffer = defaultHashBuffer,
    now = () => Date.now(),
    manifestPath = AUTO_LOAD_PATHS.manifest,
  } = dependencies;
  const decompressGzip = Object.hasOwn(dependencies, 'decompressGzip')
    ? dependencies.decompressGzip
    : createDefaultDecompressor();
  const cache = Object.hasOwn(dependencies, 'cache')
    ? dependencies.cache || NOOP_CACHE
    : createMeshCache({
        backend: createIndexedDbBackend({
          indexedDB: dependencies.indexedDB ?? globalThis.indexedDB,
        }),
      });

  if (typeof fetchFn !== 'function') {
    throw new TypeError('fetch dependency is required');
  }
  if (
    !dxfClient
    || typeof dxfClient.parse !== 'function'
    || typeof dxfClient.reprocess !== 'function'
  ) {
    throw new TypeError('DXF client dependency is required');
  }

  let currentManifest = null;

  const fetchManifest = async (signal) => {
    throwIfAborted(signal);
    try {
      const response = await fetchFn(manifestPath, {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) {
        throw new Error(`Manifest request failed with HTTP ${response.status}`);
      }
      const manifest = await response.json();
      if (!validateManifest(manifest)) {
        throw new Error('Manifest is malformed or uses another algorithm');
      }
      currentManifest = manifest;
      return manifest;
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      return null;
    }
  };

  const verifyCanonicalBuffer = async (buffer, manifest) => {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== manifest.dxf.bytes) {
      throw new Error(
        `DXF byte length mismatch: expected ${manifest.dxf.bytes}, received ${buffer?.byteLength ?? 'invalid'}`,
      );
    }
    const digest = await hashBuffer(buffer);
    if (digest && digest.toLowerCase() !== manifest.dxf.sha256.toLowerCase()) {
      throw new Error('DXF SHA-256 mismatch');
    }
    return digest || manifest.dxf.sha256;
  };

  const makeRecord = ({
    key,
    manifest,
    settingsFingerprint,
    result,
    sourceBytes = manifest.dxf.bytes,
  }) => ({
    key,
    sourceHash: manifest.dxf.sha256,
    algorithmVersion: ALGORITHM_VERSION,
    rawGeometry: result.rawGeometry,
    mesh: result.mesh,
    meshSettingsFingerprint: settingsFingerprint,
    createdAt: now(),
    sourceBytes,
  });

  const parseAndMaybeCache = async ({
    buffer,
    manifest,
    key,
    settings,
    settingsFingerprint,
    source,
    signal,
    sourceHash,
  }) => {
    const sourceBytes = buffer.byteLength;
    throwIfAborted(signal);
    let result;
    try {
      result = await dxfClient.parse(buffer, settings);
    } catch (cause) {
      if (isAbort(cause, signal)) throw cause;
      throw new DataLoadError('DXF could not be parsed', {
        stage: 'parse',
        cause,
      });
    }
    throwIfAborted(signal);
    let cacheStored = false;
    if (manifest && key) {
      cacheStored = await cache.put(key, makeRecord({
        key,
        manifest,
        settingsFingerprint,
        result,
        sourceBytes,
      }));
    }
    return {
      ...result,
      source,
      sourceHash,
      cacheStored,
      manifest,
    };
  };

  const loadRaw = async ({ manifest, settings, signal, settingsFingerprint }) => {
    const path = manifest
      ? versionedPath(manifest.dxf.path, manifest.dxf.sha256)
      : AUTO_LOAD_PATHS.dxf;
    try {
      throwIfAborted(signal);
      const response = await fetchFn(path, { signal });
      if (!response.ok) {
        throw new Error(`Raw DXF request failed with HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const sourceHash = manifest
        ? await verifyCanonicalBuffer(buffer, manifest)
        : await hashBuffer(buffer);
      const key = manifest
        ? createCacheKey(manifest.dxf.sha256, ALGORITHM_VERSION)
        : null;
      return await parseAndMaybeCache({
        buffer,
        manifest,
        key,
        settings,
        settingsFingerprint,
        source: 'raw',
        signal,
        sourceHash,
      });
    } catch (cause) {
      if (isAbort(cause, signal) || cause instanceof DataLoadError) throw cause;
      throw new DataLoadError('Canonical DXF could not be loaded', {
        stage: 'raw',
        cause,
      });
    }
  };

  return {
    async loadAutoData({ settings, signal } = {}) {
      throwIfAborted(signal);
      const settingsFingerprint = createMeshSettingsFingerprint(settings);
      const manifest = await fetchManifest(signal);
      if (!manifest) {
        return loadRaw({ manifest: null, settings, signal, settingsFingerprint });
      }

      const key = createCacheKey(manifest.dxf.sha256, ALGORITHM_VERSION);
      let cached = null;
      try {
        cached = await cache.get(key);
      } catch {
        // Cache is an optional optimization.
      }
      throwIfAborted(signal);
      if (cached?.meshSettingsFingerprint === settingsFingerprint) {
        return {
          rawGeometry: cached.rawGeometry,
          mesh: cached.mesh,
          source: 'cache',
          sourceHash: manifest.dxf.sha256,
          cacheStored: true,
          manifest,
        };
      }
      if (cached?.rawGeometry) {
        try {
          const result = await dxfClient.reprocess(cached.rawGeometry, settings);
          throwIfAborted(signal);
          const cacheStored = await cache.put(key, makeRecord({
            key,
            manifest,
            settingsFingerprint,
            result,
            sourceBytes: cached.sourceBytes || manifest.dxf.bytes,
          }));
          return {
            ...result,
            source: 'cache-reprocessed',
            sourceHash: manifest.dxf.sha256,
            cacheStored,
            manifest,
          };
        } catch (error) {
          if (isAbort(error, signal)) throw error;
          // A failed cached reprocess falls through to verified source assets.
        }
      }

      if (typeof decompressGzip === 'function') {
        try {
          const response = await fetchFn(
            versionedPath(manifest.dxf.gzipPath, manifest.dxf.sha256),
            { signal },
          );
          if (!response.ok) {
            throw new Error(`Gzip DXF request failed with HTTP ${response.status}`);
          }
          const buffer = await decompressGzip(response);
          const sourceHash = await verifyCanonicalBuffer(buffer, manifest);
          return await parseAndMaybeCache({
            buffer,
            manifest,
            key,
            settings,
            settingsFingerprint,
            source: 'gzip',
            signal,
            sourceHash,
          });
        } catch (error) {
          if (isAbort(error, signal) || error instanceof DataLoadError) throw error;
          // Gzip is optional; canonical raw DXF remains authoritative.
        }
      }

      return loadRaw({ manifest, settings, signal, settingsFingerprint });
    },

    async loadManualDxf({ buffer, settings, signal, manifest } = {}) {
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
        throw new TypeError('Manual DXF must be a non-empty ArrayBuffer');
      }
      throwIfAborted(signal);
      let knownManifest = validateManifest(manifest) ? manifest : currentManifest;
      if (!knownManifest) knownManifest = await fetchManifest(signal);
      const sourceBytes = buffer.byteLength;
      const sourceHash = await hashBuffer(buffer);
      const matchesManifest = Boolean(
        knownManifest
        && sourceHash
        && sourceBytes === knownManifest.dxf.bytes
        && sourceHash.toLowerCase() === knownManifest.dxf.sha256.toLowerCase(),
      );
      const result = await dxfClient.parse(buffer, settings);
      throwIfAborted(signal);
      let cacheStored = false;
      if (matchesManifest) {
        const key = createCacheKey(
          knownManifest.dxf.sha256,
          ALGORITHM_VERSION,
        );
        cacheStored = await cache.put(key, makeRecord({
          key,
          manifest: knownManifest,
          settingsFingerprint: createMeshSettingsFingerprint(settings),
          result,
          sourceBytes,
        }));
      }
      return {
        ...result,
        source: 'manual',
        sourceHash,
        cacheStored,
        manifest: knownManifest,
      };
    },

    getCurrentManifest() {
      return currentManifest;
    },
  };
}
