import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountdownOverlay } from '@/components/studio/CountdownOverlay';

/**
 * The countdown is a visual cue before capture, and its beats are part of the
 * product contract: 3 -> 2 -> 1 -> Record. These tests pin the visible/live
 * text and the final-word styling so a regression cannot silently turn the
 * last beat back into a number (or hide it inside an aria-hidden node).
 */
describe('CountdownOverlay', () => {
  it('shows the first beat immediately and announces it', () => {
    render(<CountdownOverlay countdownText="3" isVisible onCancel={() => {}} />);

    expect(screen.getByTestId('countdown-value')).toHaveTextContent('3');
    expect(screen.getByText('Starting in 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel countdown' })).toBeVisible();
  });

  it('renders the final beat as a word, not a number', () => {
    render(<CountdownOverlay countdownText="Record" isVisible onCancel={() => {}} />);

    const value = screen.getByTestId('countdown-value');
    expect(value).toHaveTextContent('Record');
    expect(value.className).toContain('text-5xl');
    expect(screen.getByText('Recording now')).toBeInTheDocument();
  });

  it('does not leave an empty dimmed overlay over the camera', () => {
    const { container } = render(
      <CountdownOverlay countdownText="" isVisible onCancel={() => {}} />,
    );

    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain('opacity-0');
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
  });
});
