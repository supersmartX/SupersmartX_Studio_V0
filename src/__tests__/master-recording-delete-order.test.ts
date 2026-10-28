import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Phase 8 — delete ordering.
 *
 * createMasterRecording persists the row asynchronously. An explicit discard
 * (Record Again / Delete) used to delete immediately, so a save still in
 * flight could recreate the row after the delete and resurrect the take on
 * the next visit. The delete must run after the pending save settles.
 */

const store = vi.hoisted(() => {
  let resolveSave: (() => void) | null = null;
  return {
    saveRecording: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    ),
    cleanupExpired: vi.fn(async () => 0),
    getLatestRecording: vi.fn(async () => null),
    deleteRecording: vi.fn(async () => {}),
    resolveSave: () => resolveSave?.(),
    reset: () => {
      resolveSave = null;
    },
  };
});

vi.mock('@/lib/recording-store', () => ({
  saveRecording: store.saveRecording,
  cleanupExpired: store.cleanupExpired,
  getLatestRecording: store.getLatestRecording,
  deleteRecording: store.deleteRecording,
}));

import { useMasterRecording } from '@/hooks/useMasterRecording';

describe('master recording delete ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:http://localhost/test'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('deletes again after the in-flight library save settles', async () => {
    const { result } = renderHook(() => useMasterRecording());

    let recording: any;
    act(() => {
      recording = result.current.createMasterRecording(
        new Blob(['bytes'], { type: 'video/webm' }),
        1,
        true,
        1280,
        720,
      );
    });
    expect(store.saveRecording).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.clearMasterRecording();
    });
    expect(store.deleteRecording).toHaveBeenCalledWith(recording.id);
    expect(store.deleteRecording).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.resolveSave();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      // If the pending put landed after the first delete, this second delete
      // removes the recreated row.
      expect(store.deleteRecording).toHaveBeenCalledTimes(2);
      expect(store.deleteRecording).toHaveBeenLastCalledWith(recording.id);
    });
  });
});
