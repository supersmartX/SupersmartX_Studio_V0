import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransportBar } from '@/components/layout/TransportBar';
import type { RecordingState } from '@/types';

function renderBar(state: RecordingState) {
  return render(<TransportBar {...renderBarProps(state)} />);
}

/**
 * Countdown -> cancelled must never be announced as a stopped recording. The
 * live region is the only thing a screen-reader user hears at that moment.
 */
describe('TransportBar recording announcements', () => {
  it('announces a cancelled countdown, not a finished take', () => {
    const { rerender } = renderBar('countdown');
    rerender(<TransportBar {...renderBarProps('idle')} />);

    expect(screen.getByText('Countdown cancelled.')).toBeInTheDocument();
    expect(screen.queryByText(/recording is ready to review/i)).not.toBeInTheDocument();
  });

  it('still announces a real stop when capture actually completes', () => {
    const { rerender } = renderBar('recording');
    rerender(<TransportBar {...renderBarProps('completed')} />);

    expect(
      screen.getByText(/Recording stopped\. Your recording is ready to review\./),
    ).toBeInTheDocument();
  });
});

/** The shared prop set, so a rerender does not duplicate the render helper. */
function renderBarProps(state: RecordingState) {
  return {
    recordingState: state,
    canRecord: true,
    hasRecording: false,
    isMicMuted: false,
    elapsedSeconds: 0,
    onMicToggle: vi.fn(),
    onCameraToggle: vi.fn(),
    isCameraOn: true,
    captureActive: true,
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onConfirmStop: vi.fn(),
    onSettingsClick: vi.fn(),
    onCancelCountdown: vi.fn(),
    videoDevices: [],
    audioDevices: [],
    selectedVideoDevice: '',
    selectedAudioDevice: '',
    onVideoDeviceChange: vi.fn(),
    onAudioDeviceChange: vi.fn(),
    onRefreshDevices: vi.fn(),
  };
}
