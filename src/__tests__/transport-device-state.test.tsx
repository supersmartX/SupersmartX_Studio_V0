import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransportBar } from '@/components/layout/TransportBar';
import type { RecordingState } from '@/types';

/**
 * P2-04: with no live capture the mic/camera chips are not live controls.
 * They used to read "Camera on / Mic on" before permission was even granted,
 * and stayed "on" through a permission failure.
 */
function props(state: RecordingState = 'idle') {
  return {
    recordingState: state,
    canRecord: true,
    hasRecording: false,
    isMicMuted: false,
    elapsedSeconds: 0,
    onMicToggle: vi.fn(),
    onCameraToggle: vi.fn(),
    isCameraOn: true,
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onConfirmStop: vi.fn(),
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

describe('TransportBar device chips vs capture state', () => {
  it('shows off and disables both chips when no stream exists', () => {
    render(<TransportBar {...props()} captureActive={false} />);

    expect(screen.getByRole('button', { name: 'Mic off — not started' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Camera off — not started' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Mute microphone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off camera' })).not.toBeInTheDocument();
  });

  it('restores the live toggles once a stream is captured', () => {
    const { rerender } = render(<TransportBar {...props()} captureActive={false} />);
    rerender(<TransportBar {...props()} captureActive />);

    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Turn off camera' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Mic off — not started' })).not.toBeInTheDocument();
  });
});
