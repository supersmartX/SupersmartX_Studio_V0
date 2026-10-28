'use client';

import {
  appendRecordingChunk,
  deleteChunkSession,
  listChunkSessions,
  putChunkSession,
  loadSessionChunks,
  type RecordingBackupState,
  type RecordingChunkSessionMeta,
} from '@/lib/recording/chunk-store';
import type { RecordingMetadata } from '@/types';
import { recordRecordingDiagnostic } from './diagnostics';

/**
 * Recording recovery policy + sink (Phase 9).
 *
 * The SINK (`createRecordingRecoverySink`) is the recorder-facing object: the
 * MediaRecorder hook feeds it every chunk, it keeps the local IndexedDB copy
 * fresh, and it publishes the real backup state the status UI displays
 * ("saved", "saving", "unavailable" — never fake progress).
 *
 * The POLICY functions run on the studio's next visit:
 *   - `findRecoverableSession` finds an interrupted take (crash / refresh /
 *     killed tab) whose chunks are worth reassembling;
 *   - `assembleRecoveryBlob` turns the persisted chunks back into one Blob;
 *   - `sweepAbandonedSessions` enforces the cleanup policy so abandoned
 *     sessions cannot grow forever: completed sessions never linger (the
 *     recorder deletes them at stop), zero-chunk sessions die within an
 *     hour, and any session expires after 24h — the same TTL as the master
 *     recording library.
 *
 * Storage operations are injectable (`deps`) so tests drive the real policy
 * logic against in-memory stand-ins.
 */

const ABANDONED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ZERO_CHUNK_SESSION_TTL_MS = 60 * 60 * 1000;

export interface RecoverySessionInput {
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  recordingMetadata?: RecordingMetadata;
}

export interface RecoveryAssembledTake {
  sessionId: string;
  blob: Blob;
  mimeType: string;
  extension: string;
  /** Pause-aware active capture time at the last persisted chunk (seconds). */
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  recordingMetadata?: RecordingMetadata;
}

export interface RecordingRecoveryDeps {
  putSession: typeof putChunkSession;
  appendChunk: typeof appendRecordingChunk;
  deleteSession: typeof deleteChunkSession;
  listSessions: typeof listChunkSessions;
  loadChunks: typeof loadSessionChunks;
  now: () => number;
}

const defaultDeps: RecordingRecoveryDeps = {
  putSession: putChunkSession,
  appendChunk: appendRecordingChunk,
  deleteSession: deleteChunkSession,
  listSessions: listChunkSessions,
  loadChunks: loadSessionChunks,
  now: () => Date.now(),
};

function makeSessionId(now: number): string {
  return `rec-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface RecordingRecoverySink {
  begin(meta: RecoverySessionInput): void;
  /** Receives each chunk as it arrives, plus the take's current active time (ms). */
  append(blob: Blob, activeMs: number): void;
  /**
   * Take ended IN THIS DOCUMENT (stop / error / stream change / unmount):
   * whatever happened, the finalized take no longer needs recovery chunks,
   * so the session's rows are removed.
   */
  finish(): void;
  getState(): RecordingBackupState;
  getSessionId(): string | null;
  subscribe(listener: () => void): () => void;
}

export function createRecordingRecoverySink(overrides?: Partial<RecordingRecoveryDeps>): RecordingRecoverySink {
  const deps: RecordingRecoveryDeps = { ...defaultDeps, ...overrides };

  let state: RecordingBackupState = 'inactive';
  let sessionId: string | null = null;
  let seq = 0;
  let meta: RecordingChunkSessionMeta | null = null;
  const listeners = new Set<() => void>();
  /**
   * Every session gets a generation. Async write completions from a session
   * that has already been finished must not publish state (the UI would flip
   * back from "inactive" to "saved" after the take ended).
   */
  let generation = 0;
  /** Once a chunk write fails the local copy has a permanent gap; it must not
   * claim to be "saved" again even if a later write succeeds. */
  let degraded = false;
  /** Writes in flight. finish() must delete AFTER they settle: a late
   * IndexedDB transaction would otherwise recreate the rows it just deleted,
   * leaving an orphan session that the next visit "recovers" as a duplicate. */
  const pending = new Set<Promise<unknown>>();

  const setState = (next: RecordingBackupState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const trackPending = (write: Promise<unknown>) => {
    pending.add(write);
    write.then(
      () => pending.delete(write),
      () => pending.delete(write),
    );
  };

  return {
    begin(input: RecoverySessionInput) {
      const now = deps.now();
      generation += 1;
      const gen = generation;
      sessionId = makeSessionId(now);
      seq = 0;
      degraded = false;
      meta = {
        sessionId,
        mimeType: input.mimeType,
        extension: input.extension,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        chunkCount: 0,
        totalBytes: 0,
        activeMs: 0,
        width: input.width,
        height: input.height,
        frameRate: input.frameRate,
        hasAudio: input.hasAudio,
        recordingMetadata: input.recordingMetadata,
      };
      setState('saving');
      const write = deps
        .putSession(meta)
        .catch((error) => {
          recordRecordingDiagnostic('recovery.session-write-failed', { name: error instanceof Error ? error.name : null });
          if (gen !== generation) return;
          degraded = true;
          setState('unavailable');
        });
      trackPending(write);
    },

    append(blob: Blob, activeMs: number) {
      if (!sessionId || !meta || !(blob.size > 0)) return;
      const gen = generation;
      const id = sessionId;
      seq += 1;
      const thisSeq = seq;
      const updated: RecordingChunkSessionMeta = {
        ...meta,
        updatedAt: new Date(deps.now()).toISOString(),
        chunkCount: seq,
        totalBytes: meta.totalBytes + blob.size,
        activeMs,
      };
      meta = updated;
      const write = deps
        .appendChunk({ sessionId: id, seq: thisSeq, blob, meta: updated })
        .then((result) => {
          if (gen !== generation) return;
          if (!result.ok) {
            degraded = true;
            recordRecordingDiagnostic('recovery.chunk-write-failed', { reason: result.reason ?? null, seq: thisSeq, size: blob.size });
          }
          setState(degraded ? 'unavailable' : 'saved');
        })
        .catch((error) => {
          if (gen !== generation) return;
          degraded = true;
          recordRecordingDiagnostic('recovery.chunk-write-failed', { name: error instanceof Error ? error.name : null, seq: thisSeq, size: blob.size });
          setState('unavailable');
        });
      trackPending(write);
    },

    finish() {
      const id = sessionId;
      if (!id) return;
      generation += 1;
      sessionId = null;
      meta = null;
      seq = 0;
      degraded = false;
      setState('inactive');
      // Wait for writes that started before finish(), then remove the rows.
      // Ordering matters: deleting first lets a slow in-flight transaction
      // write the session back after the delete.
      const inFlight = [...pending];
      void Promise.allSettled(inFlight)
        .then(() => deps.deleteSession(id))
        .catch(() => {
          // The sweep on the next visit still expires it; nothing to surface.
        });
    },

    getState: () => state,
    getSessionId: () => sessionId,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The interrupted session to offer for recovery on this visit, if any:
 * the most recent session that has chunks, is not expired, and is not a
 * debris row (zero chunks die within an hour; older than 24h always goes).
 * Candidates are LEFT in storage — the caller deletes the session only after
 * it successfully adopted the take (a failed adoption must not lose data).
 */
export async function findRecoverableSession(
  overrides?: Partial<RecordingRecoveryDeps>,
): Promise<RecordingChunkSessionMeta | null> {
  const deps: RecordingRecoveryDeps = { ...defaultDeps, ...overrides };
  let sessions: RecordingChunkSessionMeta[] = [];
  try {
    sessions = await deps.listSessions();
  } catch {
    return null;
  }
  const now = deps.now();
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  for (const session of sessions) {
    const updatedAt = new Date(session.updatedAt).getTime();
    // A row with an unreadable timestamp cannot be aged, so it must not be
    // offered (and cannot be trusted for assembly).
    if (!Number.isFinite(updatedAt)) continue;
    const age = now - updatedAt;
    if (age > ABANDONED_SESSION_TTL_MS) continue; // sweep removes it
    if (!(session.chunkCount > 0)) continue;
    return session;
  }
  return null;
}

/**
 * Reassembles a persisted chunk sequence into ONE playable Blob. Chunk 0
 * carries the container's initialization segment (EBML header for WebM / the
 * fragmented-MP4 moov for Safari), so the prefix-concatenation of ALL
 * persisted chunks is a valid, self-contained file — exactly what the
 * recorder's own assembly produces for a finished take.
 */
export async function assembleRecoveryBlob(
  session: RecordingChunkSessionMeta,
  overrides?: Partial<RecordingRecoveryDeps>,
): Promise<RecoveryAssembledTake | null> {
  const deps: RecordingRecoveryDeps = { ...defaultDeps, ...overrides };
  let chunks: Array<{ seq: number; blob: Blob }>;
  try {
    chunks = await deps.loadChunks(session.sessionId);
  } catch {
    return null;
  }
  if (chunks.length === 0) return null;

  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  const blob = new Blob(ordered.map((chunk) => chunk.blob), { type: session.mimeType });
  const duration = session.activeMs / 1000;
  const recordingMetadata = session.recordingMetadata
    ? {
        ...session.recordingMetadata,
        duration,
        fileSize: blob.size,
        averageFileBitrate: duration > 0 ? Math.round((blob.size * 8) / duration) : null,
        finalizationLatencyMs: null,
      }
    : undefined;
  return {
    sessionId: session.sessionId,
    blob,
    mimeType: session.mimeType,
    extension: session.extension,
    duration,
    width: session.width,
    height: session.height,
    frameRate: session.frameRate,
    hasAudio: session.hasAudio,
    recordingMetadata,
  };
}

/**
 * Cleanup policy for abandoned sessions (Phase 9: "Do not allow abandoned
 * recordings to grow forever"). Runs fire-and-forget on studio mount.
 * A session the CURRENT document is recording into must never be swept —
 * callers pass the active session id.
 */
export async function sweepAbandonedSessions(
  activeSessionId: string | null,
  overrides?: Partial<RecordingRecoveryDeps>,
): Promise<number> {
  const deps: RecordingRecoveryDeps = { ...defaultDeps, ...overrides };
  let sessions: RecordingChunkSessionMeta[] = [];
  try {
    sessions = await deps.listSessions();
  } catch {
    return 0;
  }
  const now = deps.now();
  let deleted = 0;
  for (const session of sessions) {
    if (session.sessionId === activeSessionId) continue;
    const updatedAt = new Date(session.updatedAt).getTime();
    // Unreadable metadata is debris, not a recoverable take: it can never age
    // out on its own, so the sweep removes it.
    const malformed = !Number.isFinite(updatedAt);
    const age = malformed ? Infinity : now - updatedAt;
    const expired = malformed
      ? true
      : session.chunkCount === 0
        ? age > ZERO_CHUNK_SESSION_TTL_MS
        : age > ABANDONED_SESSION_TTL_MS;
    if (!expired) continue;
    try {
      await deps.deleteSession(session.sessionId);
      deleted += 1;
    } catch {
      // Best-effort sweep; the next visit retries.
    }
  }
  return deleted;
}
