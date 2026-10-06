import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/* The store is faked so the assertions are about the browser's own copy of the
 * take — the only place it lives. The master blob is never uploaded: nothing in
 * this codebase writes to `recordings/{userId}/` on the server, and
 * `src/app/api/recordings/route.ts` is a read-only lister. So IndexedDB is the
 * entire survival story for the upgrade journey. */
const { store } = vi.hoisted(() => ({
  store: {
    latest: null as { id: string; blob: Blob; duration: number } | null,
    getLatestRecording: vi.fn(async (): Promise<unknown> => null),
    saveRecording: vi.fn(async (_recording: unknown): Promise<void> => {}),
    cleanupExpired: vi.fn(async (): Promise<number> => 0),
    deleteRecording: vi.fn(async (_id: string): Promise<void> => {}),
  },
}));

vi.mock('@/lib/recording-store', () => ({
  getLatestRecording: () => store.getLatestRecording(),
  saveRecording: (rec: unknown) => store.saveRecording(rec),
  cleanupExpired: () => store.cleanupExpired(),
  deleteRecording: (id: string) => store.deleteRecording(id),
}));

import { useMasterRecording } from '@/hooks/useMasterRecording';

const STORED_BLOB = new Blob(['the-original-take'], { type: 'video/webm' });
const NEW_BLOB = new Blob(['a-fresh-take'], { type: 'video/webm' });

function storedRecording(id = 'master-1') {
  return {
    id,
    name: '',
    blob: STORED_BLOB,
    mimeType: 'video/webm',
    extension: 'webm',
    duration: 6.4,
    hasAudio: true,
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
}

beforeEach(() => {
  // sessionStorage is per-document in the browser and per-test-file here, but
  // it persists BETWEEN tests inside this file. Each test models its own
  // fresh document (the latch is deliberately cross-document state), so any
  // leftover latch would leak one test's intent into the next.
  window.sessionStorage.clear();
  store.latest = null;
  store.getLatestRecording.mockClear();
  store.saveRecording.mockClear();
  store.cleanupExpired.mockClear();
  store.deleteRecording.mockClear();
  store.getLatestRecording.mockImplementation(async () => store.latest);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('restore carries a take across a cross-document hop', () => {
  it('repopulates the master and flags it as restored', async () => {
    store.latest = storedRecording();
    const { result } = renderHook(() => useMasterRecording());

    expect(result.current.masterRecording).toBeNull();
    expect(result.current.isRestored).toBe(false);

    await act(async () => {
      await result.current.restoreMasterRecording();
    });

    expect(result.current.masterRecording?.id).toBe('master-1');
    expect(result.current.isRestored).toBe(true);
    expect(result.current.masterRecording?.url).toContain('blob:');
    expect(result.current.masterRecording?.duration).toBe(6.4);
  });

  it('reuses the stored record verbatim — it is not re-saved under a new id', async () => {
    // The P0 gate asserts one record, same id, same size, after the payment
    // round trip. Re-persisting under a fresh `master-<ts>-<rand>` id would
    // turn a survived take into a re-record as far as storage is concerned.
    store.latest = storedRecording();
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.restoreMasterRecording();
    });

    expect(store.saveRecording).not.toHaveBeenCalled();
    expect(result.current.masterRecording?.id).toBe('master-1');
  });

  it('leaves the studio untouched when there is nothing stored', async () => {
    store.latest = null;
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.restoreMasterRecording();
    });

    expect(result.current.masterRecording).toBeNull();
    expect(result.current.isRestored).toBe(false);
  });
});

describe('a discarded take is gone, not merely hidden', () => {
  it('deletes the stored row, so the bytes cannot come back', async () => {
    store.latest = storedRecording();
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.restoreMasterRecording();
    });
    act(() => result.current.clearMasterRecording());

    expect(store.deleteRecording).toHaveBeenCalledWith('master-1');
    expect(result.current.masterRecording).toBeNull();
    expect(result.current.isRestored).toBe(false);
  });

  it('does not resurrect the take on a later restore — one attempt per document', async () => {
    // "Record again" / "open library" null the master, which re-fires the page's
    // restore effect. Without a one-shot guard the very take the user threw away
    // is pulled straight back out of IndexedDB and review re-opens on it.
    store.latest = storedRecording();
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.restoreMasterRecording();
    });
    act(() => result.current.clearMasterRecording());

    await act(async () => {
      const again = await result.current.restoreMasterRecording();
      expect(again).toBe(false);
    });

    expect(store.getLatestRecording).toHaveBeenCalledTimes(1);
    expect(result.current.masterRecording).toBeNull();
  });

  it('a take recorded while the restore read was in flight wins', async () => {
    let release: (r: typeof store.latest) => void = () => {};
    store.getLatestRecording.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );

    const { result } = renderHook(() => useMasterRecording());

    let restored: Promise<boolean>;
    act(() => {
      restored = result.current.restoreMasterRecording();
    });

    act(() => {
      result.current.createMasterRecording(NEW_BLOB, 3, true, 1280, 720);
    });

    await act(async () => {
      release(storedRecording());
      await restored!;
    });

    // The stale read must not overwrite what the user is looking at.
    expect(result.current.masterRecording?.blob).toBe(NEW_BLOB);
    expect(result.current.isRestored).toBe(false);
  });

  it('a new take clears the restored flag so review reports a live take', async () => {
    store.latest = storedRecording();
    const { result } = renderHook(() => useMasterRecording());

    await act(async () => {
      await result.current.restoreMasterRecording();
    });
    expect(result.current.isRestored).toBe(true);

    act(() => {
      result.current.createMasterRecording(NEW_BLOB, 3, true, 1280, 720);
    });

    expect(result.current.isRestored).toBe(false);
  });

  it('clearing when there is no take deletes nothing', () => {
    const { result } = renderHook(() => useMasterRecording());
    act(() => result.current.clearMasterRecording());
    expect(store.deleteRecording).not.toHaveBeenCalled();
    expect(result.current.masterRecording).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The New Video intent latch is PERSISTED (sessionStorage) so it also
 * guards the cross-document hop. That persistence cuts both ways: the take
 * that replaces a New Video session must clear it, or the very next reload
 * refuses to restore the take the user just recorded (F-01).
 * ------------------------------------------------------------------ */
describe('the New Video latch spans the document hop it guards', () => {
  it('records after New Video and restores that take on the FIRST reload', async () => {
    // New Video latches the intent so an in-flight restore cannot drag the
    // old take into the new session.
    const first = renderHook(() => useMasterRecording());
    act(() => first.result.current.releaseMasterRecording());
    expect(window.sessionStorage.getItem('sxs-new-session-intent')).toBe('1');

    // The take that replaces it is authoritative — creating it must clear
    // the persisted latch.
    act(() => {
      first.result.current.createMasterRecording(NEW_BLOB, 3, true, 1280, 720);
    });
    expect(window.sessionStorage.getItem('sxs-new-session-intent')).toBeNull();

    // "First reload": a fresh hook instance over the same storage — exactly
    // what the page gets after a document hop.
    store.latest = storedRecording('master-after-new-video');
    const second = renderHook(() => useMasterRecording());
    let restored = false;
    await act(async () => {
      restored = await second.result.current.restoreMasterRecording();
    });

    expect(restored, 'the freshly recorded take must come back out of storage').toBe(true);
    expect(second.result.current.masterRecording?.id).toBe('master-after-new-video');
    expect(second.result.current.isRestored).toBe(true);
  });

  it('New Video without a take still blocks resurrection on the next document', async () => {
    const first = renderHook(() => useMasterRecording());
    act(() => first.result.current.releaseMasterRecording());

    store.latest = storedRecording();
    const second = renderHook(() => useMasterRecording());
    let restored = true;
    await act(async () => {
      restored = await second.result.current.restoreMasterRecording();
    });

    expect(restored, 'the take left behind must stay behind').toBe(false);
    expect(second.result.current.masterRecording).toBeNull();
    // Blocked before the read, and the latch is consumed by the attempt.
    expect(store.getLatestRecording).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('sxs-new-session-intent')).toBeNull();
  });
});
