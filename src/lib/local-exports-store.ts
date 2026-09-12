'use client';

const DB_NAME = 'sxs-studio';
const DB_VERSION = 1;
const STORE_NAME = 'local-exports';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LocalExport {
  id: string;
  blob: Blob;
  platform: string;
  outputWidth: number;
  outputHeight: number;
  fileSize: number;
  createdAt: string;
  expiresAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
      // Also ensure recordings store exists (from recording-store)
      if (!db.objectStoreNames.contains('recordings')) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalExport(exp: Omit<LocalExport, 'expiresAt' | 'createdAt'> & { createdAt?: string }): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();
    const record: LocalExport = {
      ...exp,
      createdAt: exp.createdAt || new Date().toISOString(),
      expiresAt: new Date(now + TTL_MS).toISOString(),
    };
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) { console.warn('saveLocalExport failed', e); }
}

export async function getAllLocalExports(): Promise<LocalExport[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index('createdAt');
    const req = idx.openCursor(null, 'prev');
    const res: LocalExport[] = [];
    const now = new Date();
    return await new Promise((resolve) => {
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          if (new Date(cur.value.expiresAt) >= now) res.push(cur.value);
          cur.continue();
        }
      };
      tx.oncomplete = () => { db.close(); resolve(res); };
      tx.onerror = () => { db.close(); resolve(res); };
    });
  } catch { return []; }
}

export async function deleteLocalExport(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {}
}

export async function cleanupExpiredLocalExports(): Promise<number> {
  let deleted = 0;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const idx = tx.objectStore(STORE_NAME).index('expiresAt');
    const now = new Date().toISOString();
    const range = IDBKeyRange.upperBound(now);
    const req = idx.openCursor(range);
    return await new Promise((resolve) => {
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { cur.delete(); deleted++; cur.continue(); }
      };
      tx.oncomplete = () => { db.close(); resolve(deleted); };
      tx.onerror = () => { db.close(); resolve(deleted); };
    });
  } catch { return 0; }
}
