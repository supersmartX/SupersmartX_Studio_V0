import { describe, it, expect } from 'vitest';
import {
  buildPreferredVideoConstraints,
  buildPreferredAudioConstraints,
  buildCaptureConstraintLadder,
  readTrackCaptureInfo,
  readTrackCaptureMetadata,
} from '@/lib/recording/capture-constraints';

/**
 * Stable camera capture layer (Phase 4): source-quality constraints that
 * never depend on the API/user might delivers platform geometry, with
 * honest degradation and a truthful reader for the ACTUAL track settings.
 */

describe('preferred capture constraints', () => {
  it('requests 1920×1080 @ 30fps as IDEAL (never exact) so weak devices degrade', () => {
    const c = buildPreferredVideoConstraints();
    expect(c.width).toEqual({ ideal: 1920 });
    expect(c.height).toEqual({ ideal: 1080 });
    expect(c.frameRate).toEqual({ ideal: 30 });
  });

  it('defaults to the front camera, or pins the chosen device exactly', () => {
    expect(buildPreferredVideoConstraints().facingMode).toBe('user');
    expect(buildPreferredVideoConstraints('cam-2').deviceId).toEqual({ exact: 'cam-2' });
    expect(buildPreferredVideoConstraints('cam-2').facingMode).toBeUndefined();
  });

  it('pins deterministic speech processing on the microphone', () => {
    const a = buildPreferredAudioConstraints();
    expect(a.echoCancellation).toBe(true);
    expect(a.noiseSuppression).toBe(true);
    expect(a.autoGainControl).toBe(true);
    expect(buildPreferredAudioConstraints('mic-1').deviceId).toEqual({ exact: 'mic-1' });
  });
});

describe('capture constraint ladder', () => {
  it('degrades video geometry rung by rung while keeping audio processing', () => {
    const ladder = buildCaptureConstraintLadder();
    expect(ladder.length).toBeGreaterThanOrEqual(3);
    expect((ladder[0].video as MediaTrackConstraints).height).toEqual({ ideal: 1080 });
    expect((ladder[1].video as MediaTrackConstraints).height).toEqual({ ideal: 1080 });
    expect((ladder[1].video as MediaTrackConstraints).frameRate).toEqual({ ideal: 24 });
    expect((ladder[2].video as MediaTrackConstraints).height).toEqual({ ideal: 720 });
    // Audio degrades only to plain `true` at the final, worst-case rung.
    expect(ladder.every((rung) => typeof rung.audio !== 'boolean' || rung.audio === true)).toBe(true);
    expect(ladder[ladder.length - 1]).toEqual({ video: { facingMode: 'user' }, audio: true });
  });
});

describe('readTrackCaptureInfo', () => {
  it('returns the track’s REAL settings', () => {
    const stream = {
      getVideoTracks: () => [
        { getSettings: () => ({ width: 1920, height: 1080, frameRate: 29.87 }) },
      ],
    } as unknown as MediaStream;
    expect(readTrackCaptureInfo(stream)).toEqual({ width: 1920, height: 1080, frameRate: 30 });
  });

  it('returns null rather than a guess when the track reports nothing', () => {
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({}) }],
    } as unknown as MediaStream;
    expect(readTrackCaptureInfo(stream)).toBeNull();
    expect(readTrackCaptureInfo(null)).toBeNull();
  });

  it('keeps requested targets distinct from actual settings and treats deviceId as optional', () => {
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ width: 1280, height: 720, frameRate: 25, deviceId: 'camera-actual' }) }],
    } as unknown as MediaStream;
    const actual = readTrackCaptureMetadata(stream);
    expect({ requestedWidth: 1920, requestedHeight: 1080, requestedFps: 30 }).not.toEqual({
      requestedWidth: actual?.width,
      requestedHeight: actual?.height,
      requestedFps: actual?.frameRate,
    });
    expect(actual).toMatchObject({ width: 1280, height: 720, frameRate: 25, deviceId: 'camera-actual' });
  });

  it('marks a withheld device ID unavailable instead of guessing', () => {
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 }) }],
    } as unknown as MediaStream;
    expect(readTrackCaptureMetadata(stream)?.deviceId).toBeNull();
  });
});
