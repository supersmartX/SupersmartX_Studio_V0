import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ReviewPlayer } from '@/components/studio/ReviewPlayer';

/**
 * Review playback contract.
 *
 * The review surface used to be a looping <video> with a mute button and no
 * other verb: a creator who wanted to re-watch the first second could only
 * delete the take or record again. It now has a real transport — play, pause,
 * seek, restart — over the same element, still gated by `isActive` so only one
 * player is ever audible.
 */

const DURATION = 10;

interface MediaStub {
  duration: number;
  currentTime: number;
  paused: boolean;
}

/** jsdom ships no media pipeline: duration is always NaN, `paused` is a
 *  read-only true, and play/pause are not implemented. Give the element the
 *  state a real one would have, and let the tests drive its events. */
function setup(props: Partial<Parameters<typeof ReviewPlayer>[0]> = {}) {
  const utils = render(
    <ReviewPlayer videoUrl="blob:review" hasAudio isActive {...props} />,
  );
  const video = utils.container.querySelector('video')!;
  const state: MediaStub = { duration: DURATION, currentTime: 0, paused: false };
  Object.defineProperty(video, 'duration', { configurable: true, get: () => state.duration });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => state.currentTime,
    set: (value: number) => {
      state.currentTime = value;
    },
  });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => state.paused });
  // The transport reads duration from metadata; fire it like a real element.
  act(() => {
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  return { ...utils, video, state };
}

describe('ReviewPlayer transport', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.resolve()) as () => Promise<void>,
    );
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a real player, not a looping preview', () => {
    const { video } = setup();
    expect(video.loop, 'looping made an ended take unreachable').toBe(false);
    expect(video.controls, 'the review surface owns its own transport').toBe(false);
  });

  it('renders play, restart, a seek slider and the clock', () => {
    const { getByRole, container } = setup();
    expect(getByRole('button', { name: 'Play playback' })).toBeDefined();
    expect(getByRole('button', { name: 'Restart playback' })).toBeDefined();
    const seek = getByRole('slider', { name: 'Seek playback position' });
    expect(seek.getAttribute('aria-valuemax')).toBe(String(DURATION));
    expect(seek.getAttribute('aria-valuenow')).toBe('0');
    expect(seek.getAttribute('aria-valuetext')).toBe('00:00 of 00:10');
    expect(container.textContent).toContain('00:00 / 00:10');
  });

  it('the play/pause button follows the element, not a private flag', () => {
    const { video, getByRole } = setup();
    act(() => {
      video.dispatchEvent(new Event('play'));
    });
    expect(getByRole('button', { name: 'Pause playback' })).toBeDefined();
    act(() => {
      video.dispatchEvent(new Event('pause'));
    });
    expect(getByRole('button', { name: 'Play playback' })).toBeDefined();
  });

  it('seeking by pointer moves the playhead', () => {
    const { video, state, getByRole } = setup();
    const seek = getByRole('slider', { name: 'Seek playback position' });
    vi.spyOn(seek, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 6,
      right: 200,
      bottom: 6,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.click(seek, { clientX: 100 });
    expect(state.currentTime).toBeCloseTo(DURATION / 2, 5);
    expect(seek.getAttribute('aria-valuenow')).toBe('5');
  });

  it('seeking by keyboard steps, fine-steps and jumps to the ends', () => {
    const { state, getByRole } = setup();
    const seek = getByRole('slider', { name: 'Seek playback position' });
    fireEvent.keyDown(seek, { key: 'ArrowRight' });
    expect(state.currentTime).toBe(5);
    fireEvent.keyDown(seek, { key: 'ArrowRight', shiftKey: true });
    expect(state.currentTime).toBe(6);
    fireEvent.keyDown(seek, { key: 'End' });
    expect(state.currentTime).toBe(DURATION);
    fireEvent.keyDown(seek, { key: 'Home' });
    expect(state.currentTime).toBe(0);
  });

  it('restart returns to the first frame', () => {
    const { video, state, getByRole } = setup();
    state.currentTime = 7;
    fireEvent.click(getByRole('button', { name: 'Restart playback' }));
    expect(state.currentTime).toBe(0);
    expect(video.paused).toBe(false);
  });

  it('an ended take stays put and Play replays from the start', () => {
    const { video, state, getByRole } = setup();
    state.currentTime = DURATION;
    act(() => {
      video.dispatchEvent(new Event('ended'));
    });
    const play = getByRole('button', { name: 'Play playback' });
    fireEvent.click(play);
    expect(state.currentTime).toBe(0);
  });

  it('pauses while another surface owns the screen, then resumes', () => {
    const { rerender, state } = setup();
    const pause = vi.mocked(window.HTMLMediaElement.prototype.pause);
    const play = vi.mocked(window.HTMLMediaElement.prototype.play);
    pause.mockClear();
    play.mockClear();

    state.paused = false;
    rerender(<ReviewPlayer videoUrl="blob:review" hasAudio isActive={false} />);
    expect(pause).toHaveBeenCalled();

    rerender(<ReviewPlayer videoUrl="blob:review" hasAudio isActive />);
    expect(play).toHaveBeenCalled();
  });

  it('sizes the clock and scrubber from the recorded length when the blob reports none yet', () => {
    // jsdom leaves duration NaN, exactly like a just-finished MediaRecorder
    // blob in Chrome until its last fragment has been read.
    const { getByRole, container } = render(
      <ReviewPlayer videoUrl="blob:review" recordedDuration={12} hasAudio isActive />,
    );
    const seek = getByRole('slider', { name: 'Seek playback position' });
    expect(seek.getAttribute('aria-valuemax')).toBe('12');
    expect(seek.getAttribute('aria-valuetext')).toBe('00:00 of 00:12');
    expect(container.textContent).toContain('00:00 / 00:12');
  });

  it('offers the sound control only when the take has audio', () => {
    const { queryByRole } = setup({ hasAudio: false });
    expect(queryByRole('button', { name: /review playback/ })).toBeNull();
  });
});
