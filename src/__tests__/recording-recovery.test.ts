import { describe, it, expect, vi } from 'vitest';
import {
  createRecordingRecoverySink,
  findRecoverableSession,
  assembleRecoveryBlob,
  sweepAbandonedSessions,
  type RecordingRecoveryDeps,
} from '@/lib/recording/recovery';
import type {
  RecordingChunkSessionMeta,
  AppendChunkInput,
  ChunkWriteResult,
} from '@/lib/recording/chunk-store';

/**
 * Local recovery policy + sink (Phase 9), driven against in-memory stand-ins
 * injected via `deps` — the same dependency-injection seam the production
 * IndexedDB layer plugs into.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface MemoryStore {
  sessions: Map<string, RecordingChunkSessionMeta>;
  chunks: Map<string, Blob>;
  failNextAppend: boolean;
}

function makeStore(): MemoryStore {
  return { sessions: new Map(), chunks: new Map(), failNextAppend: false };
}

function makeDeps(store: MemoryStore, baseNow = 1_000_000_000): RecordingRecoveryDeps {
  return {
    putSession: async (meta: RecordingChunkSessionMeta) => {
      store.sessions.set(meta.sessionId, meta);
    },
    appendChunk: async (input: AppendChunkInput): Promise<ChunkWriteResult> => {
      if (store.failNextAppend) return { ok: false, reason: 'quota' };
      store.chunks.set(`${input.sessionId}:${input.seq}`, input.blob);
      store.sessions.set(input.meta.sessionId, input.meta);
      return { ok: true };
    },
    deleteSession: async (sessionId: string) => {
      store.sessions.delete(sessionId);
      for (const key of [...store.chunks.keys()]) {
        if (key.startsWith(`${sessionId}:`)) store.chunks.delete(key);
      }
    },
    listSessions: async () => [...store.sessions.values()],
    loadChunks: async (sessionId: string) =>
      [...store.chunks.entries()]
        .filter(([key]) => key.startsWith(`${sessionId}:`))
        .map(([key, blob]) => ({ seq: Number(key.split(':')[1]), blob })),
    now: () => baseNow,
  };
}

function metaOf(overrides: Partial<RecordingChunkSessionMeta> = {}): RecordingChunkSessionMeta {
  return {
    sessionId: 'rec-x',
    mimeType: 'video/webm;codecs=vp9,opus',
    extension: 'webm',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    chunkCount: 0,
    totalBytes: 0,
    activeMs: 0,
    width: 1920,
    height: 1080,
    frameRate: 30,
    hasAudio: true,
    ...overrides,
  };
}

describe('recording recovery sink', () => {
  it('writes every chunk and publishes real states (saving → saved)', async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    const sink = createRecordingRecoverySink(deps);
    const states: string[] = [];
    sink.subscribe(() => states.push(sink.getState()));

    expect(sink.getState()).toBe('inactive');
    sink.begin({ mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', width: 1920, height: 1080, frameRate: 30, hasAudio: true });
    expect(sink.getState()).toBe('saving');

    sink.append(new Blob(['a']), 1000);
    sink.append(new Blob(['bb']), 2000);
    sink.append(new Blob(['ccc']), 3000);

    await vi.waitFor(() => {
      expect(store.chunks.size).toBe(3);
    });

    const sessionId = sink.getSessionId()!;
    const meta = store.sessions.get(sessionId)!;
    expect(meta.chunkCount).toBe(3);
    expect(meta.totalBytes).toBe(6);
    expect(meta.activeMs).toBe(3000);
    expect(meta.mimeType).toBe('video/webm;codecs=vp9,opus');

    await vi.waitFor(() => {
      expect(sink.getState()).toBe('saved');
    });
  });

  it('reports unavailable honestly when the write fails, without stopping', async () => {
    const store = makeStore();
    store.failNextAppend = true;
    const sink = createRecordingRecoverySink(makeDeps(store));
    sink.begin({ mimeType: 'video/webm', extension: 'webm', width: 640, height: 480, frameRate: 30, hasAudio: false });
    sink.append(new Blob(['chunk']), 1000);
    await vi.waitFor(() => {
      expect(sink.getState()).toBe('unavailable');
    });
  });

  it('finish() deletes the session rows (no abandoned copy in this document)', async () => {
    const store = makeStore();
    const sink = createRecordingRecoverySink(makeDeps(store));
    sink.begin({ mimeType: 'video/webm', extension: 'webm', width: 640, height: 480, frameRate: 30, hasAudio: false });
    sink.append(new Blob(['c']), 500);
    await vi.waitFor(() => {
      expect(store.chunks.size).toBe(1);
    });
    sink.finish();
    expect(sink.getState()).toBe('inactive');
    expect(sink.getSessionId()).toBeNull();
    await vi.waitFor(() => {
      expect(store.chunks.size).toBe(0);
      expect(store.sessions.size).toBe(0);
    });
  });

  it('finish() waits for an in-flight chunk write before deleting (no orphan session)', async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    let completeWrite: (() => void) | null = null;
    let writeStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    deps.appendChunk = (input: AppendChunkInput) =>
      new Promise<ChunkWriteResult>((resolve) => {
        writeStarted?.();
        completeWrite = () => {
          store.chunks.set(`${input.sessionId}:${input.seq}`, input.blob);
          store.sessions.set(input.meta.sessionId, input.meta);
          resolve({ ok: true });
        };
      });

    const sink = createRecordingRecoverySink(deps);
    sink.begin({ mimeType: 'video/webm', extension: 'webm', width: 640, height: 480, frameRate: 30, hasAudio: false });
    await vi.waitFor(() => {
      expect(store.sessions.size).toBe(1);
    });

    sink.append(new Blob(['late']), 500);
    await started;
    sink.finish();
    expect(sink.getState()).toBe('inactive');

    // The slow write lands AFTER finish() was called; the delete must still
    // win, otherwise the next visit sees (and re-recovers) this session.
    completeWrite!();
    await vi.waitFor(() => {
      expect(store.chunks.size).toBe(0);
      expect(store.sessions.size).toBe(0);
    });
    expect(sink.getState(), 'a finished session never publishes again').toBe('inactive');
  });

  it('never returns to "saved" after a failed chunk write', async () => {
    const store = makeStore();
    store.failNextAppend = true;
    const sink = createRecordingRecoverySink(makeDeps(store));
    sink.begin({ mimeType: 'video/webm', extension: 'webm', width: 640, height: 480, frameRate: 30, hasAudio: false });

    sink.append(new Blob(['lost']), 1000);
    await vi.waitFor(() => {
      expect(sink.getState()).toBe('unavailable');
    });

    // The next write succeeds, but the backup has a permanent gap — claiming
    // "saved" would be a fake success.
    store.failNextAppend = false;
    sink.append(new Blob(['later']), 2000);
    await vi.waitFor(() => {
      expect(store.chunks.size).toBe(1);
    });
    expect(sink.getState()).toBe('unavailable');
  });

  it('finish() is a no-op when no session was opened', () => {
    const store = makeStore();
    const sink = createRecordingRecoverySink(makeDeps(store));
    expect(() => sink.finish()).not.toThrow();
    expect(store.sessions.size).toBe(0);
  });
});

describe('recovery policy', () => {
  /** jsdom's Blob predates .text(); FileReader does the same job. */
  const readBlobText = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

  it('finds the most recent session that actually has chunks', async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    const old = metaOf({ sessionId: 'rec-old', updatedAt: new Date(0).toISOString(), chunkCount: 2 });
    const fresh = metaOf({ sessionId: 'rec-fresh', updatedAt: new Date(999_500_000).toISOString(), chunkCount: 5 });
    const empty = metaOf({ sessionId: 'rec-empty', updatedAt: new Date(999_900_000).toISOString(), chunkCount: 0 });
    store.sessions.set('rec-old', old);
    store.sessions.set('rec-fresh', fresh);
    store.sessions.set('rec-empty', empty);
    store.chunks.set('rec-fresh:1', new Blob(['x']));

    const found = await findRecoverableSession(deps);
    expect(found?.sessionId).toBe('rec-fresh');
  });  it('ignores sessions older than the 24h TTL', async () => {
    const store = makeStore();
    const deps = makeDeps(store, 3_000_000_000);
    store.sessions.set(
      'rec-ancient',
      metaOf({ sessionId: 'rec-ancient', updatedAt: new Date(0).toISOString(), chunkCount: 3 }),
    );
    store.chunks.set('rec-ancient:1', new Blob(['x']));
    expect(await findRecoverableSession(deps)).toBeNull();
  });

  it('never offers or keeps a session with unreadable metadata', async () => {
    const store = makeStore();
    const deps = makeDeps(store, 1_000_000_000);
    store.sessions.set(
      'rec-malformed',
      metaOf({ sessionId: 'rec-malformed', updatedAt: 'not-a-date', chunkCount: 2 }),
    );
    store.sessions.set(
      'rec-sound',
      metaOf({ sessionId: 'rec-sound', updatedAt: new Date(999_000_000).toISOString(), chunkCount: 1 }),
    );
    store.chunks.set('rec-sound:1', new Blob(['x']));

    expect((await findRecoverableSession(deps))?.sessionId).toBe('rec-sound');
    expect(await sweepAbandonedSessions(null, deps)).toBe(1);
    expect(store.sessions.has('rec-malformed')).toBe(false);
    expect(store.sessions.has('rec-sound')).toBe(true);
  });

  it('assembles ordered chunks into one typed blob with the active-time duration', async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    const session = metaOf({ sessionId: 'rec-asm', chunkCount: 3, activeMs: 9500 });
    store.sessions.set('rec-asm', session);
    // Deliberately inserted out of order: assembly must restore sequence.
    store.chunks.set('rec-asm:3', new Blob(['3']));
    store.chunks.set('rec-asm:1', new Blob(['1']));
    store.chunks.set('rec-asm:2', new Blob(['2']));

    const take = await assembleRecoveryBlob(session, deps);
    expect(take).not.toBeNull();
    expect(take!.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(take!.duration).toBe(9.5);
    const text = await readBlobText(take!.blob);
    expect(text).toBe('123');
    expect(take!.width).toBe(1920);
    expect(take!.height).toBe(1080);
  });

  it('retains truthful recorder metadata through refresh recovery and measures the recovered file', async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    const session = metaOf({
      sessionId: 'rec-metadata',
      chunkCount: 1,
      activeMs: 2000,
      recordingMetadata: {
        profileId: '1080p30', actualProfileId: '720p30',
        requestedWidth: 1920, requestedHeight: 1080, requestedFps: 30,
        actualWidth: 1280, actualHeight: 720, actualFps: 30, deviceId: 'camera-1',
        mimeType: 'video/webm;codecs=vp9,opus',
        configuredVideoBitrate: 3_555_556, actualVideoBitrate: 3_000_000,
        configuredAudioBitrate: 128_000, actualAudioBitrate: 96_000,
        duration: 0, fileSize: 0, averageFileBitrate: null,
        startupLatencyMs: null, finalizationLatencyMs: null,
      },
    });
    store.sessions.set(session.sessionId, session);
    store.chunks.set(`${session.sessionId}:1`, new Blob(['recovered-bytes']));

    const take = await assembleRecoveryBlob(session, deps);
    expect(take?.recordingMetadata).toMatchObject({
      requestedWidth: 1920,
      actualWidth: 1280,
      profileId: '1080p30',
      actualProfileId: '720p30',
      duration: 2,
      fileSize: 15,
      averageFileBitrate: 60,
      finalizationLatencyMs: null,
    });
  });

  it('sweeps expired sessions and zero-chunk debris, keeping recent and active ones', async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    const now = 2_000_000_000;
    deps.now = () => now;

    // expired: chunks older than 24h
    store.sessions.set(
      'rec-expired',
      metaOf({ sessionId: 'rec-expired', updatedAt: new Date(now - DAY - HOUR).toISOString(), chunkCount: 4 }),
    );
    // debris: zero chunks older than 1h
    store.sessions.set(
      'rec-debris',
      metaOf({ sessionId: 'rec-debris', updatedAt: new Date(now - 2 * HOUR).toISOString(), chunkCount: 0 }),
    );
    // keep: recent with chunks
    store.sessions.set(
      'rec-recent',
      metaOf({ sessionId: 'rec-recent', updatedAt: new Date(now - 5_000).toISOString(), chunkCount: 2 }),
    );
    // keep: ACTIVE session of the current document (older, mid-append)
    store.sessions.set(
      'rec-active',
      metaOf({ sessionId: 'rec-active', updatedAt: new Date(now - DAY - HOUR).toISOString(), chunkCount: 7 }),
    );

    const deleted = await sweepAbandonedSessions('rec-active', deps);
    expect(deleted).toBe(2);
    expect([...store.sessions.keys()].sort()).toEqual(['rec-active', 'rec-recent']);
  });
});
