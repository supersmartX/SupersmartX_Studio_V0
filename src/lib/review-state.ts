import type { RecordingState } from '@/types';

export type StudioPhase = 'preparing' | 'recording' | 'review';

interface ReviewStateInput {
  /** Live capture engine state. Plain React state — no navigation carries it. */
  recordingState: RecordingState;
  /** The master recording came back out of IndexedDB, not out of this document. */
  isRestored: boolean;
  /** A master recording is currently held. */
  hasMasterRecording: boolean;
}

/**
 * Is there a finished take on screen that the user can review and export?
 *
 * Two ways to get here, and conflating them is what stranded takes after an
 * upgrade:
 *
 *   1. The capture engine finished one in THIS document ('completed').
 *   2. A PREVIOUS document left one behind and IndexedDB restored it.
 *
 * (2) is the upgrade journey: Google OAuth, the Cashfree redirect, the return
 * trip, a reload and a session refresh are all cross-document or full-remount
 * events. They destroy `recordingState` but not IndexedDB, so the take comes
 * back — while every review surface (review canvas, "Export recording",
 * "Preview as", the transport bar) was gated on 'completed' alone. The user
 * was left holding a paid-for take with no way to reach it, and the only
 * recovery was to discard and re-record.
 *
 * A restored take must therefore review IDENTICALLY to a live one. The only
 * thing `recordingState` still decides is whether a NEW take is in flight:
 * countdown / recording / paused always win, so starting a fresh take over a
 * restored one shows the live camera and drops back to review when it lands.
 */
export function isReviewState({ recordingState, isRestored, hasMasterRecording }: ReviewStateInput): boolean {
  if (recordingState === 'completed') return true;
  return isRestored && recordingState === 'idle' && hasMasterRecording;
}

/** Progressive disclosure for the UI: script/teleprompter, camera only, or take. */
export function resolveStudioPhase(input: ReviewStateInput): StudioPhase {
  if (input.recordingState === 'recording' || input.recordingState === 'paused' || input.recordingState === 'countdown') {
    return 'recording';
  }
  return isReviewState(input) ? 'review' : 'preparing';
}
