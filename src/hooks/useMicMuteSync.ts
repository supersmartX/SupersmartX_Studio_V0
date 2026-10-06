'use client';

import { useEffect } from 'react';

/**
 * Apply the mute state to whatever stream is LIVE, at the moment it changes.
 *
 * `track.enabled` used to be written only inside the mute toggle, i.e. against
 * the stream that existed when M / the button was pressed. Every re-acquisition
 * — Stop → Start, a device switch, the platform-change reinitialize — produces
 * fresh tracks that arrive ENABLED, so the button kept reporting "muted" while
 * the recording captured live audio. That is a privacy defect: the indicator
 * and the captured audio must never disagree.
 *
 * This effect is therefore the single writer of `track.enabled`:
 *
 *   - toggle pressed  → effect applies to the current stream;
 *   - stream replaced → effect re-applies the persistent mute state;
 *   - stream released → no-op, and the next acquisition is covered above.
 *
 * Both `isMicMuted` (the button, its aria-pressed) and the tracks read this
 * one state, so they cannot drift apart.
 */
export function useMicMuteSync(isMicMuted: boolean, stream: MediaStream | null): void {
  useEffect(() => {
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !isMicMuted;
    });
  }, [isMicMuted, stream]);
}
