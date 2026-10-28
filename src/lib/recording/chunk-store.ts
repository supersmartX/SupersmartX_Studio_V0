'use client';

import {
  openStudioDatabase,
  RECORDING_CHUNKS_STORE,
  RECORDING_SESSIONS_STORE,
} from '@/lib/studio-db';
import type { RecordingMetadata } from '@/types';

/**
 * Local recovery storage for active recordings (Phase 9).
 *
 * While a take records, every MediaRecorder chunk is written here (IndexedDB,
 * store `recording-chunks`, metadata in `recording-sessions`) so a refresh /
 * crash / killed tab destroys AT MOST the chunk that was in flight — never
 * the take. This is the local copy only: recordings are not uploaded as
 * chunks anywhere (the documented privacy contract keeps raw takes on the
 * device; R2 is the destination of finalized exports).
 *
 * Every operation is failure-tolerant BY CONTRACT: a recovery-copy failure
 * must never break the recording in progress (principle: R2/network/IDB
 * availability is never a hard dependency of an active local recording), so
 * writes resolve with an `ok`/`reason` verdict instead of throwing.
 *
 * The database opener is injectable (`openFn`) so tests can substitute a
 * real IndexedDB or a stand-in without mocking module internals.
 */

/** Lifecycle states of the local backup copy, surfaced to the UI verbatim. */
export type RecordingBackupState =
  | 'inactive' // no take in flight
  | 'saving' // chunks are being written
  | 'saved' // latest chunk write succeeded
  | 'unavailable'; // this browser/profile cannot write the local copy

export interface RecordingChunkSessionMeta {
  sessionId: string;
  mimeType: string;
  extension: string;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
  totalBytes: number;
  /** Pause-aware active capture time banked so far (ms). */
  activeMs: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  recordingMetadata?: RecordingMetadata;
}

export interface ChunkWriteResult {
  ok: boolean;
  reason?: 'unavailable' | 'quota' | 'error';
}

export interface StoredChunk {
  seq: number;
  blob: Blob;
}

export type OpenDatabaseFn = () => Promise<IDBDatabase>;

function classifyError(error: unknown): ChunkWriteResult {
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return { ok: false, reason: 'quota' };
  }
  return { ok: false, reason: 'error' };
}

function unwrapTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function putChunkSession(
  meta: RecordingChunkSessionMeta,
  openFn: OpenDatabaseFn = openStudioDatabase,
): Promise<void> {
  const db = await openFn();
  try {
    const tx = db.transaction(RECORDING_SESSIONS_STORE, 'readwrite');
    tx.objectStore(RECORDING_SESSIONS_STORE).put(meta);
    await unwrapTx(tx);
  } finally {
    db.close();
  }
}

export async function getChunkSession(
  sessionId: string,
  openFn: OpenDatabaseFn = openStudioDatabase,
): Promise<RecordingChunkSessionMeta | null> {
  const db = await openFn();
  try {
    const tx = db.transaction(RECORDING_SESSIONS_STORE, 'readonly');
    const request = tx.objectStore(RECORDING_SESSIONS_STORE).get(sessionId);
    const value = await new Promise<RecordingChunkSessionMeta | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as RecordingChunkSessionMeta | undefined);
      request.onerror = () => reject(request.error);
    });
    return value ?? null;
  } finally {
    db.close();
  }
}

export async function listChunkSessions(
  openFn: OpenDatabaseFn = openStudioDatabase,
): Promise<RecordingChunkSessionMeta[]> {
  const db = await openFn();
  try {
    const tx = db.transaction(RECORDING_SESSIONS_STORE, 'readonly');
    const request = tx.objectStore(RECORDING_SESSIONS_STORE).getAll();
    const values = await new Promise<RecordingChunkSessionMeta[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as RecordingChunkSessionMeta[]) ?? []);
      request.onerror = () => reject(request.error);
    });
    return values;
  } finally {
    db.close();
  }
}

export interface AppendChunkInput {
  sessionId: string;
  seq: number;
  blob: Blob;
  /** Updates the session's aggregate metadata in the same write. */
  meta: RecordingChunkSessionMeta;
}

/** Persists one chunk AND the refreshed session metadata. */
export async function appendRecordingChunk(
  { sessionId, seq, blob, meta }: AppendChunkInput,
  openFn: OpenDatabaseFn = openStudioDatabase,
): Promise<ChunkWriteResult> {
  try {
    const db = await openFn();
    try {
      const tx = db.transaction([RECORDING_CHUNKS_STORE, RECORDING_SESSIONS_STORE], 'readwrite');
      tx.objectStore(RECORDING_CHUNKS_STORE).put({ sessionId, seq, blob, createdAt: meta.updatedAt });
      tx.objectStore(RECORDING_SESSIONS_STORE).put(meta);
      await unwrapTx(tx);
      return { ok: true };
    } finally {
      db.close();
    }
  } catch (error) {
    return classifyError(error);
  }
}

/** All persisted chunks of a session, ordered by sequence. */
export async function loadSessionChunks(
  sessionId: string,
  openFn: OpenDatabaseFn = openStudioDatabase,
): Promise<StoredChunk[]> {
  const db = await openFn();
  try {
    const tx = db.transaction(RECORDING_CHUNKS_STORE, 'readonly');
    const index = tx.objectStore(RECORDING_CHUNKS_STORE).index('sessionId');
    const request = index.getAll(IDBKeyRange.only(sessionId));
    const rows = await new Promise<Array<{ seq: number; blob: Blob }>>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as Array<{ seq: number; blob: Blob }>) ?? []);
      request.onerror = () => reject(request.error);
    });
    return rows.sort((a, b) => a.seq - b.seq).map((row) => ({ seq: row.seq, blob: row.blob }));
  } finally {
    db.close();
  }
}

/** Deletes a session's metadata row and every chunk row of that session. */
export async function deleteChunkSession(
  sessionId: string,
  openFn: OpenDatabaseFn = openStudioDatabase,
): Promise<void> {
  const db = await openFn();
  try {
    const tx = db.transaction([RECORDING_CHUNKS_STORE, RECORDING_SESSIONS_STORE], 'readwrite');
    const chunkIndex = tx.objectStore(RECORDING_CHUNKS_STORE).index('sessionId');
    // IDBIndex has no direct delete: walk the index and remove each row.
    chunkIndex.openCursor(IDBKeyRange.only(sessionId)).onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.objectStore(RECORDING_SESSIONS_STORE).delete(sessionId);
    await unwrapTx(tx);
  } finally {
    db.close();
  }
}

/** Storage pressure snapshot for the preflight/status UI, when the platform exposes it. */
export async function estimateStorageQuota(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
