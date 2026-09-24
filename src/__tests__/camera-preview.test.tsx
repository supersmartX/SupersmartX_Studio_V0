import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CameraPreview } from '@/components/studio/CameraPreview';

// The remount-after-review play() race: attaching a fresh stream to a fresh
// video element can transiently reject. The preview must retry once before
// showing the blocked UI — otherwise take 2+ records blind.
describe('CameraPreview play retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function fakeStream() {
    return { active: true, getTracks: () => [] } as unknown as MediaStream;
  }

  function stubPlay(impl: () => Promise<void>) {
    return vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(impl as () => Promise<void>);
  }

  it('recovers when the retry succeeds (no blocked UI)', async () => {
    const play = stubPlay(() => Promise.resolve());
    play.mockRejectedValueOnce(new DOMException('forced transient', 'NotAllowedError'));
    render(<CameraPreview stream={fakeStream()} focusViewEnabled={false} />);
    expect(screen.queryByText(/playback blocked/i)).toBeNull();
    // Flush the rejection microtask so the retry timer gets scheduled…
    await act(async () => {
      await Promise.resolve();
    });
    // …then fire it and flush the retry outcome.
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/playback blocked/i)).toBeNull();
  });

  it('shows the blocked UI only after the retry also fails', async () => {
    const play = stubPlay(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    render(<CameraPreview stream={fakeStream()} focusViewEnabled={false} />);
    expect(screen.queryByText(/playback blocked/i)).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/playback blocked/i)).toBeInTheDocument();
  });

  it('renders nothing alarming with no stream', () => {
    stubPlay(() => Promise.resolve());
    render(<CameraPreview stream={null} focusViewEnabled={false} />);
    expect(screen.queryByText(/playback blocked/i)).toBeNull();
  });
});
