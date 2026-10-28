import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Canvas } from '@/components/layout/Canvas';

/**
 * Phase 1 item 4 — the review audio path (the canvas dimension chip is gone
 * as part of the clean-canvas redesign):
 *
 * Before the redesign Canvas carried a permanent "1920 × 1080 / Target …"
 * read-out. That was technical dashboard for a live creator surface: the real
 * dimensions now surface in the RecordingStatusLine (track settings, during a
 * take) and the review preset row (platform + dimensions, after it). These
 * tests pin the NEW contract: the canvas never shows any dimension numbers.
 *
 * Review audio:
 *   - audible when the browser allows unmuted autoplay; when policy blocks
 *     it, playback falls back to muted WITH a visible mute/unmute control
 *     (never a stranded-silent player);
 *   - the control only renders when the asset actually has audio, and it is
 *     the review player's own state — nothing here touches the mic.
 */

function renderCanvas(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  return render(
    <Canvas
      focusViewEnabled={false}
      onFocusViewToggle={() => {}}
      aspectRatio="16:9"
      {...props}
    >
      <div data-testid="preview-children" />
    </Canvas>,
  );
}

/** "×" is also the multiplication sign the old badge used — the strictest
 *  probe is on the digit-pair pattern with the sign. */
const DIMENSION_PATTERN = /\d+\s*×\s*\d+/;

describe('Canvas does not render a dimensions readout (clean-canvas redesign)', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.resolve()) as () => Promise<void>,
    );
  });

  it('no dimension numbers before any capture exists', () => {
    const { container } = renderCanvas();
    expect(container.textContent).not.toMatch(DIMENSION_PATTERN);
    expect(container.textContent).not.toMatch(/Target/);
  });

  it('no dimension numbers while a live capture is mounted', () => {
    // Children stand in for a live camera preview; no chip may appear over it.
    const { container } = renderCanvas();
    expect(container.textContent).not.toMatch(DIMENSION_PATTERN);
  });

  it('no dimension numbers during review of a take', () => {
    const { container } = renderCanvas({ reviewVideoUrl: 'blob:review' });
    expect(container.textContent).not.toMatch(DIMENSION_PATTERN);
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
