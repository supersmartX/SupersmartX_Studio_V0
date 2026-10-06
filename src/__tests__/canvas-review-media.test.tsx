import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Canvas } from '@/components/layout/Canvas';

/**
 * Phase 1 items 3 + 4 — capture-dimension accuracy and the review audio path.
 *
 * Dimension badge (item 3):
 *   - with actual capture dimensions (live track settings, or the probed
 *     take under review) it shows THOSE numbers;
 *   - before any capture exists it shows the configured target explicitly
 *     labelled "Target …" so the UI never claims a resolution it is not
 *     delivering.
 *
 * Review audio (item 4):
 *   - audible when the browser allows unmuted autoplay; when policy blocks
 *     it, playback falls back to muted WITH a visible mute/unmute control
 *     (never a stranded-silent player);
 *   - the control only renders when the asset actually has audio, and it is
 *     the review player's own state — nothing here touches the mic.
 */

const CONFIG = { width: 1920, height: 1080 } as never;

function renderCanvas(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  return render(
    <Canvas
      focusViewEnabled={false}
      onFocusViewToggle={() => {}}
      aspectRatio="16:9"
      recordingConfig={CONFIG}
      {...props}
    >
      <div data-testid="preview-children" />
    </Canvas>,
  );
}

describe('Canvas capture dimension badge', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.resolve()) as () => Promise<void>,
    );
  });

  it('labels the configured dimensions as a Target before any capture exists', () => {
    const { getByText } = renderCanvas({ captureSize: null });
    expect(getByText('Target 1920 × 1080')).toBeDefined();
  });

  it('shows the actual capture dimensions, never the configured target', () => {
    // e.g. a 640×480 camera stream under a 1920×1080 configuration — the
    // badge must report what capture is really delivering.
    const { getByText, queryByText } = renderCanvas({ captureSize: { width: 640, height: 480 } });
    expect(getByText('640 × 480')).toBeDefined();
    expect(queryByText('Target 1920 × 1080')).toBeNull();
    expect(queryByText('1920 × 1080')).toBeNull();
  });

  it('shows the take\'s own dimensions during review', () => {
    const { getByText } = renderCanvas({
      reviewVideoUrl: 'blob:review',
      captureSize: { width: 1280, height: 720 },
    });
    expect(getByText('1280 × 720')).toBeDefined();
  });

  it('falls back to the labelled target when capture dimensions are unknown', () => {
    // width 0 = restored/legacy data with no known source size.
    const { getByText } = renderCanvas({ captureSize: { width: 0, height: 0 } });
    expect(getByText('Target 1920 × 1080')).toBeDefined();
  });
});

describe('Canvas review audio control', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('plays audible when policy allows, with a visible control to mute it', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.resolve()) as () => Promise<void>,
    );
    const { container, getByRole } = renderCanvas({
      reviewVideoUrl: 'blob:review',
      reviewHasAudio: true,
    });
    const video = container.querySelector('video')!;
    expect(video.muted, 'unmuted autoplay is allowed here').toBe(false);

    const toggle = getByRole('button', { name: 'Mute review playback' });
    fireEvent.click(toggle);
    expect(video.muted).toBe(true);

    // The control state follows playback, not the microphone mute.
    getByRole('button', { name: 'Unmute review playback' });
    fireEvent.click(getByRole('button', { name: 'Unmute review playback' }));
    expect(video.muted).toBe(false);
  });

  it('falls back to muted when autoplay policy blocks playback — with the control visible', async () => {
    // Policy demands a gesture for unmuted playback: the player must start
    // (muted, as policy requires) and offer the gesture via its own button.
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.reject(new Error('not allowed'))) as unknown as () => Promise<void>,
    );
    const { container, getByRole } = renderCanvas({
      reviewVideoUrl: 'blob:review',
      reviewHasAudio: true,
    });
    // Flush the rejected play() promise so the fallback has applied.
    await act(async () => {});
    const video = container.querySelector('video')!;
    expect(video.muted, 'policy fallback is muted').toBe(true);

    const toggle = getByRole('button', { name: 'Unmute review playback' });
    expect(toggle, 'the gesture affordance must be discoverable').toBeDefined();
    fireEvent.click(toggle);
    expect(video.muted, 'one tap provides the gesture — now audible').toBe(false);
    getByRole('button', { name: 'Mute review playback' });
  });

  it('renders no audio control when the recording has no audio track', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.resolve()) as () => Promise<void>,
    );
    const { queryByRole } = renderCanvas({
      reviewVideoUrl: 'blob:review',
      reviewHasAudio: false,
    });
    expect(queryByRole('button', { name: /review playback/ })).toBeNull();
  });

  it('renders no audio control outside review mode', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.resolve()) as () => Promise<void>,
    );
    const { queryByRole } = renderCanvas({ reviewHasAudio: true });
    expect(queryByRole('button', { name: /review playback/ })).toBeNull();
  });
});
