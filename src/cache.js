import { validateMesh } from './dxf-core.js';
import { validateRawGeometry } from './dxf-client.js';

const DEFAULT_DATABASE_NAME = 'slope-viewer-cache';
const DEFAULT_STORE_NAME = 'meshes';
const DATABASE_VERSION = 1;

export function createCacheKey(sourceHash, algorithmVersion) {
  return `${sourceHash}:${algorithmVersion}`;
}

function validateMeshStats(mesh) {
  const { stats } = mesh;
  return Boolean(
    stats
    && typeof stats === 'object'
    && Number.isInteger(stats.vertexCount)
    && stats.vertexCount === mesh.x.length
    && Number.isInteger(stats.validTriangles)
    && stats.validTriangles === mesh.i.length,
  );
}

export function validateCachedGeometry(record, expectedKey = record?.key) {
  if (!record || typeof record !== 'object') return false;
  if (
    typeof expectedKey !== 'string'
    || expectedKey.length === 0
    || record.key !== expectedKey
    || typeof record.sourceHash !== 'string'
    || record.sourceHash.length === 0
    || typeof record.algorithmVersion !== 'string'
    || record.algorithmVersion.length === 0
    || createCacheKey(record.sourceHash, record.algorithmVersion) !== expectedKey
    || typeof record.meshSettingsFingerprint !== 'string'
    || record.meshSettingsFingerprint.length === 0
    || !Number.isFinite(record.createdAt)
    || !Number.isInteger(record.sourceBytes)
    || record.sourceBytes <= 0
  ) {
    return false;
  }
  return validateRawGeometry(record.rawGeometry)
    && validateMesh(record.mesh)
    && validateMeshStats(record.mesh);
}

export function createMeshCache({ backend }) {
  if (!backend) throw new TypeError('Cache backend is required');

  return {
    async get(key) {
      let record;
      try {
        record = await backend.get(key);
      } catch {
        return null;
      }
      if (!record) return null;
      if (!validateCachedGeometry(record, key)) {
        try {
          await backend.delete(key);
        } catch {
          // A corrupt entry is still treated as a miss if cleanup is blocked.
        }
        return null;
      }
      return record;
    },

    async put(key, record) {
      if (!validateCachedGeometry(record, key)) return false;
      try {
        await backend.put(key, record);
        await backend.deleteExcept(key);
        return true;
      } catch {
        return false;
      }
    },

    async delete(key) {
      try {
        await backend.delete(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createIndexedDbBackend({
  indexedDB = globalThis.indexedDB,
  dbName = DEFAULT_DATABASE_NAME,
  storeName = DEFAULT_STORE_NAME,
} = {}) {
  let databasePromise;

  const openDatabase = () => {
    if (!indexedDB || typeof indexedDB.open !== 'function') {
      return Promise.reject(new Error('IndexedDB is unavailable'));
    }
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      try {
        request = indexedDB.open(dbName, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(request.error || new Error('IndexedDB open failed'));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new Error('IndexedDB open was blocked'));
      };
    });
    return databasePromise;
  };

  const runTransaction = async (mode, operation) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error || new Error('IndexedDB transaction failed'));
      };

      try {
        transaction = database.transaction(storeName, mode);
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        transaction.onerror = () => fail(transaction.error);
        transaction.onabort = () => fail(
          transaction.error || new Error('IndexedDB transaction aborted'),
        );
        const store = transaction.objectStore(storeName);
        operation(store, (value) => { result = value; });
      } catch (error) {
        try {
          transaction?.abort();
        } catch {
          // The original exception is more useful than an abort failure.
        }
        fail(error);
      }
    });
  };

  return {
    get(key) {
      return runTransaction('readonly', (store, setResult) => {
        const request = store.get(key);
        request.onsuccess = () => setResult(request.result);
      });
    },

    put(key, record) {
      return runTransaction('readwrite', (store) => {
        store.put(record, key);
      });
    },

    delete(key) {
      return runTransaction('readwrite', (store) => {
        store.delete(key);
      });
    },

    deleteExcept(retainedKey) {
      return runTransaction('readwrite', (store) => {
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (cursor.key !== retainedKey) cursor.delete();
          cursor.continue();
        };
      });
    },

    async close() {
      if (!databasePromise) return;
      try {
        const database = await databasePromise;
        database.close();
      } finally {
        databasePromise = null;
      }
    },
  };
}
