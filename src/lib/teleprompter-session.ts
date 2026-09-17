import { FREE_SESSION_TELEPROMPTER_SECONDS } from './entitlements';

// Free teleprompter is capped per RECORDING SESSION (not per day):
// - Each new take gets a fresh allotment (min(3 min, remaining daily recording budget)).
// - Teleprompter time is merely recording time the prompter is shown for — it never
//   consumes the 10 min/day recording budget on top of normal recording.
// - When the allotment runs out mid-take, the overlay hides but the camera keeps recording.
// - Creator: unlimited (null).

// Cap (in seconds) for a single take. recordingCapSeconds is the remaining daily recording
// budget for the current take (used by the recording timer); null = unlimited (Creator).
export function getTeleprompterSessionCap(options: {
  isCreator?: boolean;
  recordingCapSeconds: number | null;
}): number | null {
  if (options.isCreator) return null;
  const recordingCap = options.recordingCapSeconds ?? FREE_SESSION_TELEPROMPTER_SECONDS;
  return Math.max(0, Math.min(FREE_SESSION_TELEPROMPTER_SECONDS, recordingCap));
}

// Seconds of teleprompter time left in the current take. elapsedSeconds only advances while
// the recording is actively rolling, so pausing does not consume teleprompter time.
export function getTeleprompterRemainingInSession(cap: number | null, elapsedSeconds: number): number | null {
  if (cap === null) return null;
  return Math.max(0, cap - elapsedSeconds);
}