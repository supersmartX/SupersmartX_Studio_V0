'use client';

const DB_NAME = 'sxs-studio';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';
const RECORDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredRecording {
  id: string;
  blob: Blob;
  mimeType: string;
  extension: string;
  duration: number;
  hasAudio: boolean;
  width: number;
  height: number;
  aspectRatio: string;
  createdAt: string;
  expiresAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveRecording(recording: StoredRecording): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const now = Date.now();
    const record = {
      ...recording,
      createdAt: recording.createdAt || new Date().toISOString(),
      expiresAt: new Date(now + RECORDING_TTL_MS).toISOString(),
    };

    store.put(record);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Silently fail - recording persistence is best-effort
  }
}

export async function getRecording(id: string): Promise<StoredRecording | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    return new Promise((resolve) => {
      request.onsuccess = () => {
        db.close();
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }
        if (new Date(result.expiresAt) < new Date()) {
          deleteRecording(id);
          resolve(null);
          return;
        }
        resolve(result);
      };
      request.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

export async function deleteRecording(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Silently fail
  }
}

export async function cleanupExpired(): Promise<number> {
  let deletedCount = 0;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('expiresAt');
    const now = new Date().toISOString();

    const range = IDBKeyRange.upperBound(now);
    const request = index.openCursor(range);

    return new Promise((resolve) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(deletedCount);
      };
      tx.onerror = () => {
        db.close();
        resolve(deletedCount);
      };
    });
  } catch {
    return 0;
  }
}

export async function getLatestRecording(): Promise<StoredRecording | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const request = index.openCursor(null, 'prev');

    return new Promise((resolve) => {
      request.onsuccess = () => {
        const cursor = request.result;
        db.close();
        if (!cursor) {
          resolve(null);
          return;
        }
        const result = cursor.value;
        if (new Date(result.expiresAt) < new Date()) {
          deleteRecording(result.id);
          resolve(null);
          return;
        }
        resolve(result);
      };
      request.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}
