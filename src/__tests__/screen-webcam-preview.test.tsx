import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenWebcamPreview } from '@/components/studio/ScreenWebcamPreview';
import { DEFAULT_WEBCAM_OVERLAY } from '@/lib/recording/webcam-overlay';
import type { WebcamOverlaySettings } from '@/types';

/**
 * The Screen + Webcam composition surface: the draggable/resizable webcam
 * frame aligned over the canvas. Its controls live in the WebcamToolbar tray
 * BELOW the preview (see webcam-toolbar.test.tsx) — this surface must render
 * no chrome over the recorded pixels at all.
 */

type PreviewProps = Parameters<typeof ScreenWebcamPreview>[0];
type MockFn = ReturnType<typeof vi.fn>;

function props(overrides: Partial<PreviewProps> = {}): PreviewProps & {
  onOverlayChange: MockFn;
} {
  const base = {
    canvasEl: null,
    overlay: { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.25 } as WebcamOverlaySettings,
    onOverlayChange: vi.fn(),
    cameraAspect: 16 / 9,
    screenActive: true,
    ...overrides,
  };
  return base as PreviewProps & { onOverlayChange: MockFn };
}

function lastChange(mock: { mock: { calls: unknown[][] } }): Partial<WebcamOverlaySettings> {
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[mock.mock.calls.length - 1][0] as Partial<WebcamOverlaySettings>;
}

describe('ScreenWebcamPreview surface', () => {
  it('renders no toolbar over the recording — controls live in the tray below', () => {
    render(<ScreenWebcamPreview {...props()} />);
    expect(screen.queryByTestId('webcam-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    // The letterboxed canvas strip is still addressable for the tray layout.
    expect(screen.getByTestId('webcam-canvas-strip')).toBeInTheDocument();
  });

  it('hides the overlay frame when the webcam is hidden', () => {
    const p = props({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, x: 0.8, y: 0.8, scale: 0.25, visible: false } });
    const { rerender } = render(<ScreenWebcamPreview {...p} />);
    expect(screen.queryByTestId('webcam-overlay-frame')).not.toBeInTheDocument();
    rerender(<ScreenWebcamPreview {...p} overlay={{ ...p.overlay, visible: true }} />);
    expect(screen.getByTestId('webcam-overlay-frame')).toBeInTheDocument();
  });

  it('renders the frame only over a live screen share', () => {
    const p = props({ screenActive: false });
    render(<ScreenWebcamPreview {...p} />);
    expect(screen.queryByTestId('webcam-overlay-frame')).not.toBeInTheDocument();
  });
});

describe('ScreenWebcamPreview drag', () => {
  it('moves the overlay with the pointer and clamps it inside the canvas', () => {
    const p = props();
    render(<ScreenWebcamPreview {...p} />);
    const frame = screen.getByTestId('webcam-overlay-frame');

    // jsdom gives elements zero-size rects; the drag math divides by the
    // display size, so seed the fitted canvas strip with a real rect.
    const strip = screen.getByTestId('webcam-canvas-strip');
    Object.defineProperty(strip, 'getBoundingClientRect', {
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
    const strip = screen.getByTestId('webcam-canvas-strip');
    Object.defineProperty(strip, 'getBoundingClientRect', {
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
