import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast } from '@/components/common/Toast';

/**
 * The notice has no close control of its own — no X, no Escape handler, no
 * outside-click dismissal, and it is `pointer-events-none` so it cannot even be
 * clicked away. Its timed hide is therefore its ONLY dismissal, and it must be
 * bound to the rendered classes: `displayMessage` outlives the timer on purpose
 * (the text stays put through the exit transition), so a static class string
 * leaves the last notice — e.g. the "Shortcuts" help text — on screen forever.
 */
describe('Toast dismissal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fades itself out when its lifetime expires', () => {
    render(<Toast message="Space: Start / Stop recording · Esc: Close" />);

    const notice = screen.getByRole('status');
    expect(notice.className).toContain('opacity-100');

    act(() => {
      vi.advanceTimersByTime(2700);
    });

    expect(screen.getByRole('status').className).toContain('opacity-0');
  });

  it('fades out when the owner clears the message', () => {
    const { rerender } = render(<Toast message="That take is under a second — retake before exporting." />);
    expect(screen.getByRole('status').className).toContain('opacity-100');

    rerender(<Toast message={null} />);
    expect(screen.getByRole('status').className).toContain('opacity-0');
  });

  it('stays transparent to the pointer in both states', () => {
    const { rerender } = render(<Toast message="Stop the recording first" />);
    expect(screen.getByRole('status').className).toContain('pointer-events-none');

    rerender(<Toast message={null} />);
    expect(screen.getByRole('status').className).toContain('pointer-events-none');
  });

  it('comes back for the next notice after fading', () => {
    const { rerender } = render(<Toast message="First notice" />);
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    expect(screen.getByRole('status').className).toContain('opacity-0');

    rerender(<Toast message="Second notice" />);
    const notice = screen.getByRole('status');
    expect(notice.className).toContain('opacity-100');
    expect(notice).toHaveTextContent('Second notice');
  });
});
