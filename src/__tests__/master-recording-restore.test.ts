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
