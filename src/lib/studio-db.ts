'use client';

/**
 * Shared IndexedDB schema for the studio (DB `sxs-studio`).
 *
 * Three feature modules share ONE database: master recordings (`recordings`),
 * Free-plan local exports (`local-exports`) and recording-recovery chunks
 * (`recording-chunks` + `recording-sessions`). They MUST open it through this
 * single helper:
 *
 *   - IndexedDB fails an open with a LOWER version than the current one, so
 *     each module pinning its own copy of the version number breaks the
 *     moment another module bumps it.
 *   - The upgrade lists every store idempotently, so whichever module opens
 *     first creates all stores; later opens never re-run an upgrade.
 *
 * Version 3 adds the recovery stores (chunk + session). The store set of
 * versions 1–2 is preserved untouched — never rename existing stores.
 */

export const STUDIO_DB_NAME = 'sxs-studio';
export const STUDIO_DB_VERSION = 3;

export const RECORDINGS_STORE = 'recordings';
export const LOCAL_EXPORTS_STORE = 'local-exports';
export const RECORDING_CHUNKS_STORE = 'recording-chunks';
export const RECORDING_SESSIONS_STORE = 'recording-sessions';

export function openStudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(STUDIO_DB_NAME, STUDIO_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        const store = db.createObjectStore(RECORDINGS_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(LOCAL_EXPORTS_STORE)) {
        const store = db.createObjectStore(LOCAL_EXPORTS_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }

      // Recovery stores (v3): one row per persisted chunk, keyed by
      // [sessionId, seq]; the index answers "all chunks of a session" and the
      // sessions store carries the metadata the recovery policy needs.
      if (!db.objectStoreNames.contains(RECORDING_CHUNKS_STORE)) {
        const store = db.createObjectStore(RECORDING_CHUNKS_STORE, {
          keyPath: ['sessionId', 'seq'],
        });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }

      if (!db.objectStoreNames.contains(RECORDING_SESSIONS_STORE)) {
        db.createObjectStore(RECORDING_SESSIONS_STORE, { keyPath: 'sessionId' });
      }
    };

    request.onblocked = () => console.warn('[IDB] open blocked — close other tabs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}
