import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveRecording, type StoredRecording } from '@/lib/recording-store';

/**
 * Phase 8 — the library write must REPORT its outcome.
 *
 * saveRecording used to swallow every failure, which made the studio's
 * onSaveError path unreachable: a take whose row was never written still
 * looked saved until the next reload, when it was gone.
 */

function stored(): StoredRecording {
  return {
    id: 'master-test',
    name: '',
    blob: new Blob(['bytes'], { type: 'video/webm' }),
    mimeType: 'video/webm',
    extension: 'webm',
    duration: 1,
    hasAudio: true,
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveRecording outcome', () => {
  it('resolves after the IndexedDB transaction completes', async () => {
    const tx = {
      objectStore: () => ({ put: vi.fn() }),
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    const db = { transaction: () => tx, close: vi.fn() };
    const request: Record<string, unknown> = {
      onupgradeneeded: null,
      onblocked: null,
      onsuccess: null,
      onerror: null,
      result: db,
      error: null,
    };
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        setTimeout(() => {
          (request.onsuccess as (() => void) | null)?.();
          // saveRecording creates the transaction in the continuation that
          // runs after this microtask, so complete it on the NEXT turn.
          setTimeout(() => tx.oncomplete?.(), 0);
        }, 0);
        return request;
      }),
    });

    await expect(saveRecording(stored())).resolves.toBeUndefined();
    expect(tx.objectStore).toBeDefined();
    expect(db.close).toHaveBeenCalled();
  });

  it('rejects when the write fails, so the caller can report an unsaved take', async () => {
    const request: Record<string, unknown> = {
      onupgradeneeded: null,
      onblocked: null,
      onsuccess: null,
      onerror: null,
      error: new Error('quota exceeded'),
    };
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        setTimeout(() => (request.onerror as (() => void) | null)?.(), 0);
        return request;
      }),
    });

    await expect(saveRecording(stored())).rejects.toThrow('quota exceeded');
  });
});
