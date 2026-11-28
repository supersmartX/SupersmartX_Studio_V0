import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WebcamToolbar, ScreenShareActions } from '@/components/studio/WebcamToolbar';
import { DEFAULT_WEBCAM_OVERLAY } from '@/lib/recording/webcam-overlay';
import type { WebcamOverlaySettings } from '@/types';

/**
 * The webcam control tray that sits BELOW the canvas preview. Contract the
 * recording reliability rules depend on: visibility changes are UI-only and
 * must never touch the recording path, the tray is a single nowrap row (a
 * wrapped stack used to cover the recording), and it stays live mid-take.
 */

type ToolbarProps = Parameters<typeof WebcamToolbar>[0];
type MockFn = ReturnType<typeof vi.fn>;

function props(overrides: Partial<ToolbarProps> = {}): ToolbarProps & {
  onOverlayChange: MockFn;
  onCameraToggle: MockFn;
  onVideoDeviceChange: MockFn;
} {
  const base = {
    overlay: { ...DEFAULT_WEBCAM_OVERLAY } as WebcamOverlaySettings,
    onOverlayChange: vi.fn(),
    canvasAspect: 16 / 9,
    cameraAspect: 16 / 9,
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
  return base as ToolbarProps & { onOverlayChange: MockFn; onCameraToggle: MockFn; onVideoDeviceChange: MockFn };
}

function lastChange(mock: { mock: { calls: unknown[][] } }): Partial<WebcamOverlaySettings> {
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[mock.mock.calls.length - 1][0] as Partial<WebcamOverlaySettings>;
}

describe('WebcamToolbar controls', () => {
  function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
    const p = props(overrides);
    render(<WebcamToolbar {...p} />);
    return p;
  }

  it('hides the webcam without touching any recording control', () => {
    const p = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Hide webcam' }));
    expect(lastChange(p.onOverlayChange)).toEqual({ visible: false });
  });

  it('restores a hidden webcam', () => {
    const p = renderToolbar({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, visible: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Show webcam' }));
    expect(lastChange(p.onOverlayChange)).toEqual({ visible: true });
  });

  it('resizes within the scale clamp', () => {
    const p = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Make webcam smaller' }));
    expect(lastChange(p.onOverlayChange).scale).toBeCloseTo(p.overlay.scale - 0.03, 6);
  });

  it('disables resize buttons at the clamps', () => {
    const { unmount } = render(
      <WebcamToolbar {...props({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, scale: 0.12 } })} />,
    );
    expect(screen.getByRole('button', { name: 'Make webcam smaller' })).toBeDisabled();
    unmount();
    render(<WebcamToolbar {...props({ overlay: { ...DEFAULT_WEBCAM_OVERLAY, scale: 0.45 } })} />);
    expect(screen.getByRole('button', { name: 'Make webcam larger' })).toBeDisabled();
  });

  it('toggles the camera shape', () => {
    const p = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Use circular webcam shape' }));
    expect(lastChange(p.onOverlayChange)).toEqual({ shape: 'circle' });
  });

  it('toggles mirroring with a pressed state', () => {
    const p = renderToolbar();
    const mirror = screen.getByRole('button', { name: 'Disable webcam mirroring' });
    expect(mirror).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(mirror);
    expect(lastChange(p.onOverlayChange)).toEqual({ mirrored: false });
  });

  it('moves the overlay with corner presets using the live canvas aspect', () => {
    // A portrait canvas (9/16): the bottom corners must clamp inside it.
    const p = renderToolbar({ canvasAspect: 9 / 16 });
    fireEvent.click(screen.getByRole('button', { name: 'Move webcam to bottom right' }));
    const patch = lastChange(p.onOverlayChange) as { x: number; y: number };
    expect(patch.x).toBeLessThan(1);
    expect(patch.x).toBeGreaterThan(0.5);
    expect(patch.y).toBeGreaterThan(0.75);
  });

  it('selects a camera device', () => {
    const p = renderToolbar();
    fireEvent.change(screen.getByRole('combobox', { name: 'Webcam camera device' }), {
      target: { value: 'cam-b' },
    });
    expect(p.onVideoDeviceChange).toHaveBeenCalledWith('cam-b');
  });

  it('locks camera device switching while a take is live', () => {
    renderToolbar({ deviceChangeLocked: true });
    expect(screen.getByRole('combobox', { name: 'Webcam camera device' })).toBeDisabled();
  });

  it('offers an explicit camera capture off switch (distinct from Hide)', () => {
    const p = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera capture off' }));
    expect(p.onCameraToggle).toHaveBeenCalledTimes(1);
    // Hide and camera-off are separate controls.
    expect(screen.getByRole('button', { name: 'Hide webcam' })).toBeInTheDocument();
  });
});

describe('WebcamToolbar share actions', () => {
  function renderShare(overrides: Partial<ToolbarProps> = {}) {
    const p = props({
      showShareActions: true,
      onChangeSource: vi.fn(),
      onStopSharing: vi.fn(),
      ...overrides,
    });
    render(<WebcamToolbar {...p} />);
    return {
      onChangeSource: p.onChangeSource as unknown as MockFn,
      onStopSharing: p.onStopSharing as unknown as MockFn,
    };
  }

  it('joins the pill while idle and fires both actions', () => {
    const p = renderShare();
    fireEvent.click(screen.getByRole('button', { name: 'Change screen source' }));
    expect(p.onChangeSource).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop screen sharing' }));
    expect(p.onStopSharing).toHaveBeenCalledTimes(1);
  });

  it('leaves the pill mid-take (idle-only), keeping the row height stable', () => {
    renderShare({ showShareActions: false });
    expect(screen.queryByRole('button', { name: 'Change screen source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop screen sharing' })).not.toBeInTheDocument();
    // The webcam controls remain — the pill never empties mid-take.
    expect(screen.getByRole('button', { name: 'Hide webcam' })).toBeInTheDocument();
  });

  it('renders standalone for screen-only mode', () => {
    render(<ScreenShareActions onChangeSource={vi.fn()} onStopSharing={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Change screen source' })).toHaveTextContent('Change source');
    expect(screen.getByRole('button', { name: 'Stop screen sharing' })).toHaveTextContent('Stop sharing');
  });
});

describe('WebcamToolbar layout', () => {
  // jsdom's ResizeObserver stub never fires; a harness that replays a
  // contentRect drives the tray's measured width for the compact tests.
  const instances: { fire: (width: number) => void }[] = [];
  class ResizeObserverHarness {
    constructor(callback: (entries: ResizeObserverEntry[]) => void) {
      instances.push({
        fire: (width) =>
          act(() => {
            callback([{ contentRect: { width } } as ResizeObserverEntry]);
          }),
      });
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  let original: typeof ResizeObserver;

  beforeEach(() => {
    original = globalThis.ResizeObserver;
    instances.length = 0;
    globalThis.ResizeObserver = ResizeObserverHarness as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  function renderMeasured(width: number, overrides: Partial<ToolbarProps> = {}) {
    const p = props(overrides);
    render(<WebcamToolbar {...p} />);
    instances[instances.length - 1]?.fire(width);
    return p;
  }

  it('is a single nowrap row that never stacks over the recording', () => {
    const { unmount } = render(<WebcamToolbar {...props()} />);
    expect(screen.getByTestId('webcam-toolbar').className).toContain('flex-nowrap');
    unmount();
    renderMeasured(360);
    expect(screen.getByTestId('webcam-toolbar').className).toContain('flex-nowrap');
  });

  it('drops text labels in the compact (narrow tray) layout but keeps every control', () => {
    renderMeasured(360);
    const toolbar = screen.getByTestId('webcam-toolbar');
    expect(toolbar).not.toHaveTextContent('Hide');
    expect(toolbar).not.toHaveTextContent('Mirror');
    expect(screen.getByRole('button', { name: 'Hide webcam' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make webcam smaller' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make webcam larger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use circular webcam shape' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move webcam to bottom right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable webcam mirroring' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Webcam camera device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn camera capture off' })).toBeInTheDocument();
  });

  it('keeps the full labels when the tray is wide', () => {
    renderMeasured(1000);
    const toolbar = screen.getByTestId('webcam-toolbar');
    expect(toolbar).toHaveTextContent('Hide');
    expect(toolbar).toHaveTextContent('Mirror');
  });
});
