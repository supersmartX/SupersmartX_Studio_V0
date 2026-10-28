import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  selectRecordingCodec,
  resetRecordingCodecCache,
  bitrateForDimensions,
  isMediaRecorderSupported,
} from '@/lib/recording/codec-capability';

/**
 * Deterministic codec fallback strategy (Phase 5/15). Every candidate must be
 * gated by isTypeSupported — the ladder order and the no-support outcome are
 * contracts the UI and preflight rely on.
 *
 * Note: the real runtime order intentionally prefers WebM (VP9 → VP8) before
 * MP4 (Safari's H.264) because multencoded Chromium quality-per-bit is
 * measured to be better at the same bitrate.
 */

function stubMediaRecorder(supported: string[]) {
  class FakeRecorder {}
  (FakeRecorder as unknown as { isTypeSupported: (mime: string) => boolean }).isTypeSupported =
    (mime: string) => supported.includes(mime);
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
}

describe('recording codec selection', () => {
  beforeEach(() => {
    resetRecordingCodecCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRecordingCodecCache();
  });

  it('prefers VP9+Opus WebM when the browser declares it', () => {
    stubMediaRecorder(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    const codec = selectRecordingCodec();
    expect(codec?.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(codec?.container).toBe('webm');
  });

  it('falls through VP9 to VP8 when only VP8 is available', () => {
    stubMediaRecorder(['video/webm;codecs=vp8,opus']);
    expect(selectRecordingCodec()?.mimeType).toBe('video/webm;codecs=vp8,opus');
  });

  it('lands on plain MP4 when only H.264/AAC containers exist (Safari path)', () => {
    stubMediaRecorder(['video/mp4']);
    const codec = selectRecordingCodec();
    expect(codec?.mimeType).toBe('video/mp4');
    expect(codec?.container).toBe('mp4');
    expect(codec?.extension).toBe('mp4');
  });

  it('returns null (and never a guessed MIME) when nothing is supported', () => {
    stubMediaRecorder([]);
    expect(selectRecordingCodec()).toBeNull();
  });

  it('reports unsupported when MediaRecorder is absent entirely', () => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    expect(isMediaRecorderSupported()).toBe(false);
    expect(selectRecordingCodec()).toBeNull();
  });

  it('is deterministic within a document (support does not change mid-session)', () => {
    stubMediaRecorder(['video/webm;codecs=vp9,opus']);
    expect(selectRecordingCodec()?.mimeType).toBe('video/webm;codecs=vp9,opus');
    // Capability collapses mid-session: the cached selection persists.
    stubMediaRecorder([]);
    expect(selectRecordingCodec()?.mimeType).toBe('video/webm;codecs=vp9,opus');
  });
});

describe('recording bitrate selection', () => {
  it('anchors 1080p30 at 8 Mbps (browser defaults are ~2.5 Mbps)', () => {
    expect(bitrateForDimensions(1920, 1080, 30)).toBe(8_000_000);
  });

  it('scales with capture geometry and frame rate', () => {
    expect(bitrateForDimensions(1280, 720, 30)).toBeLessThan(8_000_000);
    expect(bitrateForDimensions(1280, 720, 30)).toBe(3_555_556);
    expect(bitrateForDimensions(1280, 720, 60)).toBeGreaterThan(bitrateForDimensions(1280, 720, 30));
    expect(bitrateForDimensions(1280, 720, 25)).toBeGreaterThan(bitrateForDimensions(1280, 720, 24));
  });

  it('applies the low and high bitrate clamps', () => {
    expect(bitrateForDimensions(320, 240, 15)).toBe(2_500_000);
    expect(bitrateForDimensions(7680, 4320, 120)).toBe(20_000_000);
  });

  it('never begs 4K automatically and never falls below a quality floor', () => {
    expect(bitrateForDimensions(3840, 2160, 30)).toBeLessThanOrEqual(20_000_000);
    expect(bitrateForDimensions(640, 480, 30)).toBeGreaterThanOrEqual(2_500_000);
  });

  it('has a sane answer even when the track reported nothing', () => {
    expect(bitrateForDimensions()).toBe(8_000_000);
  });
});
