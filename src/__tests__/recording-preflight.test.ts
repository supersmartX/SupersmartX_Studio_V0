import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runRecordingPreflight,
  type PreflightIssue,
} from '@/lib/recording/preflight';
import { resetRecordingCodecCache } from '@/lib/recording/codec-capability';

/**
 * Recording preflight (Phase 12): a REAL readiness check. The fatal mass is
 * only ever produced by things the check actually verified — no guessing.
 */

function stubMediaRecorder(supported: string[]) {
  class FakeRecorder {}
  (FakeRecorder as unknown as { isTypeSupported: (mime: string) => boolean }).isTypeSupported =
    (mime: string) => supported.includes(mime);
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
}

function streamWithTracks(video: boolean, audio: boolean): MediaStream {
  const makeTrack = () => ({ readyState: 'live' });
  return {
    getVideoTracks: () => (video ? [makeTrack()] : []),
    getAudioTracks: () => (audio ? [makeTrack()] : []),
  } as unknown as MediaStream;
}

function fatalIssues(issues: PreflightIssue[]): PreflightIssue[] {
  return issues.filter((i) => i.severity === 'fatal');
}

describe('recording preflight', () => {
  beforeEach(() => {
    resetRecordingCodecCache();
    stubMediaRecorder(['video/webm;codecs=vp9,opus']);
  });

  afterEach(() => {
    // jsdom has no MediaRecorder/indexedDB; restore that state between tests.
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    resetRecordingCodecCache();
  });

  it('ready when a live stream and a supported codec exist', async () => {
    const result = await runRecordingPreflight({ stream: streamWithTracks(true, true) });
    expect(result.ready).toBe(true);
    expect(result.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(fatalIssues(result.issues)).toHaveLength(0);
  });

  it('fatal when MediaRecorder does not exist at all', async () => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    resetRecordingCodecCache();
    const result = await runRecordingPreflight({ stream: streamWithTracks(true, true) });
    expect(result.ready).toBe(false);
    expect(result.mimeType).toBeNull();
    expect(fatalIssues(result.issues).map((i) => i.id)).toContain('media-recorder-unsupported');
  });

  it('fatal when no recording format is supported', async () => {
    stubMediaRecorder([]);
    resetRecordingCodecCache();
    const result = await runRecordingPreflight({ stream: streamWithTracks(true, true) });
    expect(result.ready).toBe(false);
    expect(fatalIssues(result.issues).map((i) => i.id)).toContain('no-supported-codec');
  });

  it('fatal when the stream has no live tracks', async () => {
    const result = await runRecordingPreflight({ stream: streamWithTracks(false, false) });
    expect(result.ready).toBe(false);
    expect(fatalIssues(result.issues).map((i) => i.id)).toContain('no-live-tracks');
  });

  it('fatal when there is no stream at all', async () => {
    const result = await runRecordingPreflight({ stream: null });
    expect(result.ready).toBe(false);
    expect(fatalIssues(result.issues).map((i) => i.id)).toContain('no-live-tracks');
  });

  it('warns (not blocks) when recovery storage is unavailable', async () => {
    const result = await runRecordingPreflight({ stream: streamWithTracks(true, true) });
    expect(result.ready).toBe(true);
    expect(result.issues.map((i) => i.id)).toContain('recovery-storage-unavailable');
  });
});
