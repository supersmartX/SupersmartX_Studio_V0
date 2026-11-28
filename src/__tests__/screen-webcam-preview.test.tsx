import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenWebcamPreview } from '@/components/studio/ScreenWebcamPreview';
import { DEFAULT_WEBCAM_OVERLAY } from '@/lib/recording/webcam-overlay';
import type { WebcamOverlaySettings } from '@/types';

/**
 * The Screen + Webcam interaction surface: drag, resize, shape, corner
 * presets, mirror, show/hide, camera device and camera-off — the toolbar and
 * frame contract the recording reliability rules depend on (visibility changes
 * are UI-only and must never touch the recording path).
 */

type PreviewProps = Parameters<typeof ScreenWebcamPreview>[0];
type MockFn = ReturnType<typeof vi.fn>;

function props(overrides: Partial<PreviewProps> = {}): PreviewProps & {
  onOverlayChange: MockFn;
  onCameraToggle: MockFn;
  onVideoDeviceChange: MockFn;
} {
  const base = {
    canvasEl: null,
    overlay: { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.25 } as WebcamOverlaySettings,
    onOverlayChange: vi.fn(),
    cameraAspect: 16 / 9,
    screenActive: true,
    isCameraOn: true,
    onCameraToggle: vi.fn(),
    videoDevices: [
      { deviceId: 'cam-a', kind: 'videoinput', label: 'Built-in Camera', groupId: 'g', toJSON: () => {} } as MediaDeviceInfo,
      { deviceId: 'cam-b', kind: 'videoinput', label: 'External Camera', groupId: 'g', toJSON: () => {} } as MediaDeviceInfo,
    ],
    selectedVideoDevice: 'cam-a',
    onVideoDeviceChange: vi.fn(),
    deviceChangeLocked: false,
    ...overrides,
  };
  return base as PreviewProps & { onOverlayChange: MockFn; onCameraToggle: MockFn; onVideoDeviceChange: MockFn };
}

function lastChange(mock: { mock: { calls: unknown[][] } }): Partial<WebcamOverlaySettings> {
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[mock.mock.calls.length - 1][0] as Partial<WebcamOverlaySettings>;
}

describe('ScreenWebcamPreview toolbar', () => {
  // One render per test: testing-library cleanup runs between tests, not
  // between renders, so a shared beforeEach render would leave a second live
  // instance in the DOM and duplicate every query.
  function renderPreview(overrides: Partial<PreviewProps> = {}) {
    const p = props(overrides);
    render(<ScreenWebcamPreview {...p} />);
    return p;
  }

  it('hides the webcam without touching any recording control', () => {
    const p = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Hide webcam' }));
    expect(lastChange(p.onOverlayChange)).toEqual({ visible: false });
  });

  it('restores a hidden webcam', () => {
    const p = renderPreview({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.25, visible: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Show webcam' }));
    expect(lastChange(p.onOverlayChange)).toEqual({ visible: true });
  });

  it('hides the overlay frame when the webcam is hidden', () => {
    const p = props({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.25, visible: false } });
    const { rerender } = render(<ScreenWebcamPreview {...p} />);
    expect(screen.queryByTestId('webcam-overlay-frame')).not.toBeInTheDocument();
    rerender(<ScreenWebcamPreview {...p} overlay={{ ...p.overlay, visible: true }} />);
    expect(screen.getByTestId('webcam-overlay-frame')).toBeInTheDocument();
  });

  it('resizes within the scale clamp', () => {
    const p = renderPreview();
    const smaller = screen.getByRole('button', { name: 'Make webcam smaller' });
    fireEvent.click(smaller);
    expect(lastChange(p.onOverlayChange).scale).toBeCloseTo(p.overlay.scale - 0.03, 6);
  });

  it('disables resize buttons at the clamps', () => {
    const { unmount } = render(
      <ScreenWebcamPreview {...props({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.12 } })} />,
    );
    expect(screen.getByRole('button', { name: 'Make webcam smaller' })).toBeDisabled();
    unmount();
    render(<ScreenWebcamPreview {...props({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.45 } })} />);
    expect(screen.getByRole('button', { name: 'Make webcam larger' })).toBeDisabled();
  });

  it('toggles the camera shape', () => {
    const p = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Use circular webcam shape' }));
    expect(lastChange(p.onOverlayChange)).toEqual({ shape: 'circle' });
  });

  it('toggles mirroring with a pressed state', () => {
    const p = renderPreview();
    const mirror = screen.getByRole('button', { name: 'Disable webcam mirroring' });
    expect(mirror).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(mirror);
    expect(lastChange(p.onOverlayChange)).toEqual({ mirrored: false });
  });

  it('moves the overlay with corner presets', () => {
    const p = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Move webcam to top left' }));
    const patch = lastChange(p.onOverlayChange) as { x: number; y: number };
    expect(patch.x).toBeLessThan(0.25);
    expect(patch.y).toBeLessThan(0.25);
  });

  it('selects a camera device', () => {
    const p = renderPreview();
    fireEvent.change(screen.getByRole('combobox', { name: 'Webcam camera device' }), {
      target: { value: 'cam-b' },
    });
    expect(p.onVideoDeviceChange).toHaveBeenCalledWith('cam-b');
  });

  it('locks camera device switching while a take is live', () => {
    renderPreview({ deviceChangeLocked: true });
    expect(screen.getByRole('combobox', { name: 'Webcam camera device' })).toBeDisabled();
  });

  it('offers an explicit camera capture off switch (distinct from Hide)', () => {
    const p = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera capture off' }));
    expect(p.onCameraToggle).toHaveBeenCalledTimes(1);
    // Hide and camera-off are separate controls.
    expect(screen.getByRole('button', { name: 'Hide webcam' })).toBeInTheDocument();
  });
});

describe('ScreenWebcamPreview drag', () => {
  it('moves the overlay with the pointer and clamps it inside the canvas', () => {
    const p = props();
    render(<ScreenWebcamPreview {...p} />);
    const frame = screen.getByTestId('webcam-overlay-frame');

    // jsdom gives elements zero-size rects; the drag math divides by the
    // display size, so seed the content box with a real rect.
    const host = screen.getByTestId('webcam-toolbar').parentElement!;
    Object.defineProperty(host, 'getBoundingClientRect', {
      value: () => ({ width: 1000, height: 562.5, top: 0, left: 0 } as DOMRect),
      configurable: true,
    });

    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 800, clientY: 450, button: 0 });
    // Drag left and up by 100px on a 1000x562.5 display → normalized deltas.
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 700, clientY: 350 });
    fireEvent.pointerUp(frame, { pointerId: 1 });

    const patch = lastChange(p.onOverlayChange) as { x: number; y: number };
    expect(patch.x).toBeCloseTo(p.overlay.x - 0.1, 6);
    expect(patch.y).toBeCloseTo(p.overlay.y - 100 / 562.5, 6);
    // Clamped result must stay inside the canvas.
    expect(patch.x).toBeGreaterThan(0);
    expect(patch.y).toBeGreaterThan(0);
  });

  it('ignores moves from other pointers and stops after pointerup', () => {
    const p = props();
    render(<ScreenWebcamPreview {...p} />);
    const frame = screen.getByTestId('webcam-overlay-frame');
    const host = screen.getByTestId('webcam-toolbar').parentElement!;
    Object.defineProperty(host, 'getBoundingClientRect', {
      value: () => ({ width: 1000, height: 562.5, top: 0, left: 0 } as DOMRect),
      configurable: true,
    });

    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 800, clientY: 450, button: 0 });
    fireEvent.pointerMove(frame, { pointerId: 2, clientX: 0, clientY: 0 });
    expect(p.onOverlayChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(frame, { pointerId: 1 });
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(p.onOverlayChange).not.toHaveBeenCalled();
  });
});

describe('ScreenWebcamPreview keyboard', () => {
  it('nudges the overlay with arrow keys and resizes with plus/minus', () => {
    const p = props();
    render(<ScreenWebcamPreview {...p} overlay={{ ...p.overlay, x: 0.5, y: 0.5 }} />);
    const frame = screen.getByTestId('webcam-overlay-frame');

    fireEvent.keyDown(frame, { key: 'ArrowLeft' });
    expect((lastChange(p.onOverlayChange) as { x: number }).x).toBeCloseTo(0.49, 6);

    fireEvent.keyDown(frame, { key: 'ArrowRight', shiftKey: true });
    expect((lastChange(p.onOverlayChange) as { x: number }).x).toBeCloseTo(0.55, 6);

    fireEvent.keyDown(frame, { key: 'ArrowUp' });
    expect((lastChange(p.onOverlayChange) as { y: number }).y).toBeCloseTo(0.49, 6);

    fireEvent.keyDown(frame, { key: '+' });
    expect((lastChange(p.onOverlayChange) as { scale: number }).scale).toBeCloseTo(p.overlay.scale + 0.03, 6);

    fireEvent.keyDown(frame, { key: '-' });
    expect((lastChange(p.onOverlayChange) as { scale: number }).scale).toBeCloseTo(p.overlay.scale - 0.03, 6);
  });

  it('does not swallow unrelated keys', () => {
    const p = props();
    render(<ScreenWebcamPreview {...p} />);
    fireEvent.keyDown(screen.getByTestId('webcam-overlay-frame'), { key: 'a' });
    expect(p.onOverlayChange).not.toHaveBeenCalled();
  });
});

describe('ScreenWebcamPreview frame visibility', () => {
  it('renders the toolbar before the screen share starts (pre-configure)', () => {
    const p = props({ screenActive: false });
    render(<ScreenWebcamPreview {...p} />);
    expect(screen.getByTestId('webcam-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('webcam-overlay-frame')).not.toBeInTheDocument();
  });
});
