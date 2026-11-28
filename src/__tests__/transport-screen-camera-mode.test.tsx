import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransportBar } from '@/components/layout/TransportBar';

/**
 * The capture-source radio group must offer all three recording modes —
 * Camera, Screen, and Screen + Webcam — and the combined mode must present
 * both the screen status pill and the camera chip.
 */
function props(overrides: Record<string, unknown> = {}) {
  return {
    recordingState: 'idle' as const,
    canRecord: true,
    hasRecording: false,
    isMicMuted: false,
    elapsedSeconds: 0,
    onMicToggle: vi.fn(),
    captureSource: 'camera' as const,
    onCaptureSourceChange: vi.fn(),
    isScreenSharing: false,
    screenShareSupported: true,
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
    captureActive: true,
    ...overrides,
  };
}

describe('TransportBar recording modes', () => {
  it('offers the Screen + Webcam mode in the capture-source group', () => {
    render(<TransportBar {...props()} />);
    const group = screen.getByRole('radiogroup', { name: 'Capture source' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Screen + Cam' })).toBeInTheDocument();
  });

  it('selects the Screen + Webcam mode', () => {
    const p = props();
    render(<TransportBar {...p} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Screen + Cam' }));
    expect(p.onCaptureSourceChange).toHaveBeenCalledWith('screen-camera');
  });

  it('disables the Screen + Webcam option when screen sharing is unsupported', () => {
    render(<TransportBar {...props({ screenShareSupported: false })} />);
    expect(screen.getByRole('radio', { name: 'Screen + Cam' })).toBeDisabled();
  });

  it('shows the screen pill AND the camera chip in Screen + Webcam mode', () => {
    render(
      <TransportBar
        {...props({
          captureSource: 'screen-camera',
          isScreenSharing: true,
          screenShareSurface: 'monitor',
        })}
      />,
    );
    expect(screen.getByText('Entire Screen')).toBeInTheDocument();
    // The camera chip remains a live control (on/off + device picking).
    expect(screen.getByRole('button', { name: 'Turn off camera' })).toBeInTheDocument();
  });

  it('does not show the camera chip in screen-only mode', () => {
    render(<TransportBar {...props({ captureSource: 'screen', isScreenSharing: true })} />);
    expect(screen.queryByRole('button', { name: 'Turn off camera' })).not.toBeInTheDocument();
  });

  it('locks mode switching while a take is live', () => {
    // The capture-source group renders only in an idle state, so during a
    // take there is no radio to click at all — a stronger lock than disabled.
    render(<TransportBar {...props({ recordingState: 'recording' })} />);
    expect(screen.queryByRole('radiogroup', { name: 'Capture source' })).not.toBeInTheDocument();
  });
});
