import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordingStatusLine } from '@/components/studio/RecordingStatusLine';

/**
 * Phase 13 status line — every state it can display is REAL, so a fake one
 * is a contract violation these tests pin in place (no invented cloud
 * states, no invented progress).
 */

describe('RecordingStatusLine', () => {
  it('renders nothing while no take is backed up', () => {
    const { container } = render(<RecordingStatusLine capture={null} backupState="inactive" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the ACTUAL capture geometry (track settings, never a target)', () => {
    render(
      <RecordingStatusLine
        capture={{ width: 1920, height: 1080, frameRate: 30 }}
        backupState="saved"
      />,
    );
    expect(screen.getByText(/1920 × 1080 · 30 fps/)).toBeInTheDocument();
    expect(screen.getByText('Local backup')).toBeInTheDocument();
  });

  it('shows fps only when the track reported one', () => {
    render(
      <RecordingStatusLine capture={{ width: 1280, height: 720 }} backupState="saving" />,
    );
    expect(screen.getByText('1280 × 720')).toBeInTheDocument();
    expect(screen.getByText('Backing up locally')).toBeInTheDocument();
  });

  it('reports an unavailable local backup honestly', () => {
    render(
      <RecordingStatusLine capture={{ width: 640, height: 480 }} backupState="unavailable" />,
    );
    expect(screen.getByText(/Local backup unavailable/)).toBeInTheDocument();
  });

  it('never invents a cloud upload state (device-local contract)', () => {
    const states = ['saved', 'saving', 'unavailable'] as const;
    for (const backupState of states) {
      const { container, unmount } = render(
        <RecordingStatusLine capture={{ width: 1920, height: 1080 }} backupState={backupState} />,
      );
      expect(container.textContent).not.toMatch(/cloud/i);
      expect(container.textContent).not.toMatch(/upload/i);
      unmount();
    }
  });
});
