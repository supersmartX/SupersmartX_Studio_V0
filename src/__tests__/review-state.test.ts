import { describe, it, expect } from 'vitest';
import { isReviewState, resolveStudioPhase } from '@/lib/review-state';
import type { RecordingState } from '@/types';

const STATES: RecordingState[] = ['idle', 'countdown', 'recording', 'paused', 'completed'];

/* The upgrade journey this file exists for:
 *
 *   Free records → review → upgrade → auth → Cashfree → return → review again
 *
 * Google OAuth, the Cashfree redirect, the return trip, a page reload and a
 * session refresh are all cross-document or full-remount events. They wipe
 * `recordingState` (plain React state in src/hooks/useRecorder.ts:35) but not
 * IndexedDB. Every review surface was gated on 'completed' alone, so after a
 * payment the take was intact in storage and completely unreachable in the UI.
 */
describe('review survives every cross-document hop of the upgrade journey', () => {
  it('a take restored from IndexedDB is in review even though the capture engine is idle', () => {
    // The state a user lands in immediately after the Cashfree return.
    expect(
      isReviewState({ recordingState: 'idle', isRestored: true, hasMasterRecording: true })
    ).toBe(true);
  });

  it('a restored take presents the same phase as a freshly completed one', () => {
    const restored = resolveStudioPhase({ recordingState: 'idle', isRestored: true, hasMasterRecording: true });
    const live = resolveStudioPhase({ recordingState: 'completed', isRestored: false, hasMasterRecording: true });
    expect(restored).toBe('review');
    expect(restored).toBe(live);
  });

  it('a take finished in this document is still in review', () => {
    expect(
      isReviewState({ recordingState: 'completed', isRestored: false, hasMasterRecording: true })
    ).toBe(true);
  });

  it('never invents a review out of a restore flag with no take behind it', () => {
    // The restore path requires an actual master. `isRestored` alone is set by
    // the IndexedDB read, and an expired or cleared row must leave the studio
    // in 'preparing' with the Enable-camera overlay, not on an empty review.
    for (const recordingState of STATES) {
      if (recordingState === 'completed') continue; // see below
      expect(isReviewState({ recordingState, isRestored: true, hasMasterRecording: false })).toBe(false);
    }
  });

  it('"completed" reports review even in the tick before the master exists', () => {
    // The engine sets 'completed' and the master is created a frame later,
    // once the metadata probe has read the real dimensions. That transient
    // predates this module and is unchanged: the review canvas appears on
    // schedule rather than flashing the live camera.
    expect(isReviewState({ recordingState: 'completed', isRestored: false, hasMasterRecording: false })).toBe(true);
  });

  it('never shows review for a take that was not restored and is not held', () => {
    // The cold first load: no camera, no script, no take. Pre-permission users
    // must still land on the Enable-camera overlay, not on a phantom review.
    expect(isReviewState({ recordingState: 'idle', isRestored: false, hasMasterRecording: false })).toBe(false);
    expect(resolveStudioPhase({ recordingState: 'idle', isRestored: false, hasMasterRecording: false })).toBe('preparing');
  });

  it('a new take always wins over a restored one, and lands back in review after', () => {
    const restored: Parameters<typeof isReviewState>[0] = {
      recordingState: 'idle',
      isRestored: true,
      hasMasterRecording: true,
    };
    expect(resolveStudioPhase(restored)).toBe('review');

    // "Record again" over a restored take: countdown and the take itself must
    // show the live camera, never the old video.
    for (const recordingState of ['countdown', 'recording', 'paused'] as RecordingState[]) {
      expect(resolveStudioPhase({ ...restored, recordingState })).toBe('recording');
    }

    // The new take completing puts the user back in review — on the new take.
    expect(resolveStudioPhase({ recordingState: 'completed', isRestored: false, hasMasterRecording: true })).toBe('review');
  });

  it('only the restored-and-idle combination is the new case', () => {
    // Guards against the restore being wired too wide: a restored flag with no
    // master, or a master with no restore, must both fall back to today's
    // behaviour rather than inventing a review state.
    for (const recordingState of ['idle', 'countdown', 'recording', 'paused'] as RecordingState[]) {
      expect(isReviewState({ recordingState, isRestored: true, hasMasterRecording: false })).toBe(false);
      expect(isReviewState({ recordingState, isRestored: false, hasMasterRecording: true })).toBe(false);
    }
  });
});

describe('phase resolution is total', () => {
  it.each(STATES)('%s maps to a phase', (recordingState) => {
    for (const isRestored of [false, true]) {
      for (const hasMasterRecording of [false, true]) {
        expect(['preparing', 'recording', 'review']).toContain(
          resolveStudioPhase({ recordingState, isRestored, hasMasterRecording })
        );
      }
    }
  });
});
