import { describe, expect, it } from 'vitest';
import { getBestRecordingProfile, profileForActualCapture } from '@/lib/recording-profiles';

const vp9 = { mimeType: 'video/webm;codecs=vp9,opus', container: 'webm' as const, extension: 'webm' };

describe('recording profiles', () => {
  it('prefers 1080p30 when reported camera limits support it', () => {
    expect(getBestRecordingProfile({
      codec: vp9,
      capabilities: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } },
    })).toMatchObject({ id: '1080p30', targetWidth: 1920, targetHeight: 1080, targetFps: 30, preferredCodecFamily: 'vp9' });
  });

  it('selects 720p for a 720p camera', () => {
    expect(getBestRecordingProfile({
      codec: vp9,
      capabilities: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 } },
    }).id).toBe('720p30');
  });

  it('selects a lower-FPS profile for unusual 25 FPS capability', () => {
    expect(getBestRecordingProfile({
      codec: vp9,
      capabilities: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 25 } },
    }).id).toBe('1080p-low-fps');
  });

  it('falls back to the best supported profile when higher targets are unavailable', () => {
    const input = { codec: vp9, capabilities: { width: { max: 640 }, height: { max: 480 }, frameRate: { max: 30 } } };
    expect(getBestRecordingProfile(input).id).toBe('480p30');
    expect(getBestRecordingProfile(input)).toEqual(getBestRecordingProfile(input));
  });

  it('keeps requested targets separate from actual track geometry', () => {
    const requested = getBestRecordingProfile({ codec: vp9, capabilities: null });
    const actual = profileForActualCapture({ width: 1280, height: 720, frameRate: 25 }, vp9);
    expect(requested.id).toBe('1080p30');
    expect(actual.id).toBe('720p-low-fps');
    expect(actual.preferredCodecFamily).toBe('vp9');
  });

  it('uses an honest device-default profile when no reported caps fit a known rung', () => {
    expect(getBestRecordingProfile({
      codec: null,
      capabilities: { width: { max: 320 }, height: { max: 240 }, frameRate: { max: 15 } },
    })).toMatchObject({ id: 'device-default', tier: 'unknown', preferredCodecFamily: null });
  });
});
