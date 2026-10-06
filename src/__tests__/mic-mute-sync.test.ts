/**
 * The mute state must reach the tracks that are actually being recorded.
 *
 * `track.enabled` used to be written only inside the mute toggle, so a stream
 * acquired AFTER the toggle (Stop → Start, a device switch) came back with
 * enabled-by-default tracks and recorded live audio while the button claimed
 * muted. `useMicMuteSync` is now the single writer, applied on every toggle
 * AND every stream change; this test drives exactly that sequence.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

import { useMicMuteSync } from '@/hooks/useMicMuteSync';

type Props = { isMicMuted: boolean; stream: MediaStream | null };

function fakeTrack(enabled = true): MediaStreamTrack {
  return { enabled } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function renderMute(initial: Props) {
  return renderHook(
    ({ isMicMuted, stream }: Props) => useMicMuteSync(isMicMuted, stream),
    { initialProps: initial },
  );
}

describe('useMicMuteSync', () => {
  it('mute → stop → start leaves the re-acquired stream muted', () => {
    const liveTrack = fakeTrack();
    const liveStream = fakeStream([liveTrack]);

    const { rerender } = renderMute({ isMicMuted: false, stream: liveStream });
    expect(liveTrack.enabled, 'unmuted means the track keeps capturing').toBe(true);

    // Mute (button or keyboard): applied to the tracks being recorded NOW.
    rerender({ isMicMuted: true, stream: liveStream });
    expect(liveTrack.enabled).toBe(false);

    // Stop: camera released.
    rerender({ isMicMuted: true, stream: null });

    // Start: a fresh stream whose tracks arrive ENABLED — this is the
    // re-acquisition that used to record live audio under a muted button.
    const reacquiredTrack = fakeTrack();
    const reacquiredStream = fakeStream([reacquiredTrack]);
    rerender({ isMicMuted: true, stream: reacquiredStream });
    expect(
      reacquiredTrack.enabled,
      'the mute must be re-applied to a re-acquired stream',
    ).toBe(false);
  });

  it('unmuting re-enables the live tracks', () => {
    const track = fakeTrack(false);
    const stream = fakeStream([track]);

    const { rerender } = renderMute({ isMicMuted: true, stream });
    expect(track.enabled).toBe(false);

    rerender({ isMicMuted: false, stream });
    expect(track.enabled).toBe(true);
  });

  it('is a no-op for a stream without audio tracks', () => {
    let reads = 0;
    const videoOnly = {
      getAudioTracks: () => {
        reads += 1;
        return [] as MediaStreamTrack[];
      },
      getTracks: () => [],
    } as unknown as MediaStream;

    expect(() => renderMute({ isMicMuted: true, stream: videoOnly })).not.toThrow();
    // Still read once (to apply), never a crash path.
    expect(reads).toBeGreaterThan(0);
  });

  it('a null stream is safe: no crash before the camera is acquired', () => {
    expect(() => renderMute({ isMicMuted: true, stream: null })).not.toThrow();
    expect(() => renderMute({ isMicMuted: false, stream: null })).not.toThrow();
  });

  it('the mute button reports the same single state the tracks read', () => {
    // TransportBar's aria-pressed and the track.enabled writes both derive
    // from the page's one `isMicMuted` value, so indicator and captured
    // audio cannot disagree.
    const transport = readFileSync(
      join(process.cwd(), 'src', 'components', 'layout', 'TransportBar.tsx'),
      'utf8',
    );
    expect(transport).toContain('aria-pressed={isMicMuted}');
  });
});
