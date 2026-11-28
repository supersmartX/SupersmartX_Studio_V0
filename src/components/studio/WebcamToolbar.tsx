'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebcamOverlaySettings } from '@/types';
import {
  WEBCAM_SCALE_MAX,
  WEBCAM_SCALE_MIN,
  WEBCAM_SCALE_STEP,
  clampScale,
  cornerOverlayPosition,
  type WebcamCorner,
} from '@/lib/recording/webcam-overlay';
import {
  CameraIcon,
  CameraOffIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  FlipIcon,
  MinusIcon,
  PlusIcon,
  ScreenShareIcon,
} from '@/components/icons';

interface WebcamToolbarProps {
  overlay: WebcamOverlaySettings;
  onOverlayChange: (patch: Partial<WebcamOverlaySettings>) => void;
  /** Live canvas aspect (width/height) — corner presets clamp against it. */
  canvasAspect: number;
  /** Camera frame aspect (width/height), matching what the compositor uses. */
  cameraAspect: number;
  isCameraOn: boolean;
  onCameraToggle: () => void;
  videoDevices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  onVideoDeviceChange: (deviceId: string) => void;
  /** Device switching re-acquires the stream — locked while a take is live. */
  deviceChangeLocked: boolean;
  /**
   * Screen-share management actions (Change source / Stop sharing), shown
   * while idle only — they join the pill behind a divider so the tray's row
   * height never changes when a take starts or stops.
   */
  showShareActions?: boolean;
  onChangeSource?: () => void;
  onStopSharing?: () => void;
}

/**
 * Fitted width (px) below which the toolbar drops its text labels and shrinks
 * the device select, so it always stays ONE row instead of wrapping.
 */
const TOOLBAR_COMPACT_WIDTH_PX = 560;

/**
 * Screen-share management actions. Standalone (screen-only mode) they render
 * with labels; inside the webcam pill they inherit the compact icon-only
 * treatment via `compact`.
 */
export function ScreenShareActions({
  onChangeSource,
  onStopSharing,
  compact = false,
}: {
  onChangeSource: () => void;
  onStopSharing: () => void;
  compact?: boolean;
}) {
  const shareButton =
    'flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-elevated hover:text-text-primary';
  return (
    <>
      <button
        type="button"
        onClick={onChangeSource}
        aria-label="Change screen source"
        title="Change source"
        className={shareButton}
      >
        <ScreenShareIcon className="h-4 w-4" />
        {!compact && <span>Change source</span>}
      </button>
      <button
        type="button"
        onClick={onStopSharing}
        aria-label="Stop screen sharing"
        title="Stop sharing"
        className={shareButton}
      >
        <CloseIcon className="h-4 w-4" />
        {!compact && <span>Stop sharing</span>}
      </button>
    </>
  );
}

/**
 * The Screen + Webcam control strip. It lives BELOW the canvas preview —
 * in its own tray outside the platform frame — so no control ever covers
 * the recorded pixels, on any platform format or viewport. DOM-only chrome:
 * it is never part of the recorded composition, so it stays live (and
 * usable) while a take is running.
 */
export function WebcamToolbar({
  overlay,
  onOverlayChange,
  canvasAspect,
  cameraAspect,
  isCameraOn,
  onCameraToggle,
  videoDevices,
  selectedVideoDevice,
  onVideoDeviceChange,
  deviceChangeLocked,
  showShareActions = false,
  onChangeSource,
  onStopSharing,
}: WebcamToolbarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);

  // Measure the tray row (not the pill) so the compact decision reflects the
  // space actually available to center the pill in.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setRowWidth(entry.contentRect.width);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const toolbarCompact = rowWidth > 0 && rowWidth < TOOLBAR_COMPACT_WIDTH_PX;

  const moveCorner = useCallback(
    (corner: WebcamCorner) => {
      // Same math the compositor and the preview frame use, so a corner
      // preset from the tray lands exactly where the canvas draws it.
      const position = cornerOverlayPosition(corner, overlay.scale, overlay.shape, cameraAspect, canvasAspect);
      onOverlayChange(position);
    },
    [overlay.scale, overlay.shape, cameraAspect, canvasAspect, onOverlayChange],
  );

  const toolbarButton =
    'flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div ref={rowRef} className="flex w-full min-w-0 justify-center">
      <div
        role="toolbar"
        aria-label="Webcam controls"
        data-testid="webcam-toolbar"
        className="flex flex-nowrap items-center justify-center gap-0.5 rounded-2xl border border-border-default bg-surface/95 p-1 shadow-2xl max-w-full"
      >
        <button
          type="button"
          onClick={() => onOverlayChange({ visible: !overlay.visible })}
          aria-label={overlay.visible ? 'Hide webcam' : 'Show webcam'}
          title={overlay.visible ? 'Hide webcam (recording continues without it)' : 'Show webcam'}
          className={toolbarButton}
        >
          {overlay.visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          {!toolbarCompact && <span className="ml-1">{overlay.visible ? 'Hide' : 'Show'}</span>}
        </button>

        <button
          type="button"
          onClick={() => onOverlayChange({ scale: clampScale(overlay.scale - WEBCAM_SCALE_STEP) })}
          disabled={overlay.scale <= WEBCAM_SCALE_MIN}
          aria-label="Make webcam smaller"
          title="Smaller"
          className={toolbarButton}
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onOverlayChange({ scale: clampScale(overlay.scale + WEBCAM_SCALE_STEP) })}
          disabled={overlay.scale >= WEBCAM_SCALE_MAX}
          aria-label="Make webcam larger"
          title="Larger"
          className={toolbarButton}
        >
          <PlusIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => onOverlayChange({ shape: overlay.shape === 'circle' ? 'rounded' : 'circle' })}
          aria-pressed={overlay.shape === 'circle'}
          aria-label={overlay.shape === 'circle' ? 'Use rounded rectangle webcam shape' : 'Use circular webcam shape'}
          title={overlay.shape === 'circle' ? 'Rounded rectangle' : 'Circle'}
          className={toolbarButton}
        >
          {overlay.shape === 'circle' ? (
            <span aria-hidden="true" className="block h-3.5 w-3.5 rounded-[4px] border-2 border-current" />
          ) : (
            <span aria-hidden="true" className="block h-3.5 w-3.5 rounded-full border-2 border-current" />
          )}
        </button>

        {/* Corner presets — a 2x2 mini-grid reads as "position" at a glance. */}
        <div className="grid grid-cols-2 gap-0.5 rounded-lg p-0.5" role="group" aria-label="Webcam position presets">
          {(
            [
              ['top-left', 'Move webcam to top left'],
              ['top-right', 'Move webcam to top right'],
              ['bottom-left', 'Move webcam to bottom left'],
              ['bottom-right', 'Move webcam to bottom right'],
            ] as const
          ).map(([corner, label]) => (
            <button
              key={corner}
              type="button"
              onClick={() => moveCorner(corner)}
              aria-label={label}
              title={label}
              className="flex h-[17px] w-[17px] items-center justify-center rounded-[3px] p-0 text-text-muted transition-colors hover:bg-white/[0.1] hover:text-text-primary"
            >
              <span
                aria-hidden="true"
                className="block h-1.5 w-1.5 rounded-[1px] bg-current"
                style={{ margin: 'auto' }}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onOverlayChange({ mirrored: !overlay.mirrored })}
          aria-pressed={overlay.mirrored}
          aria-label={overlay.mirrored ? 'Disable webcam mirroring' : 'Mirror webcam preview'}
          title="Mirror"
          className={toolbarButton}
        >
          {toolbarCompact ? (
            <FlipIcon className="h-4 w-4" />
          ) : (
            <span>Mirror</span>
          )}
        </button>

        <select
          aria-label="Webcam camera device"
          title="Camera device"
          value={overlay.deviceId || selectedVideoDevice}
          onChange={(e) => onVideoDeviceChange(e.target.value)}
          disabled={deviceChangeLocked || videoDevices.length === 0}
          className={`ml-0.5 rounded-lg border border-border-default bg-elevated px-1.5 py-1.5 text-[11px] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 ${
            toolbarCompact ? 'w-[88px]' : 'max-w-[110px]'
          }`}
        >
          {videoDevices.length === 0 && <option value="">No camera found</option>}
          {videoDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>

        {/* Explicit camera-off: unlike Hide (which only stops drawing), this
            actually stops camera capture — mic audio stays alive. */}
        <button
          type="button"
          onClick={onCameraToggle}
          aria-pressed={isCameraOn ? undefined : true}
          aria-label={isCameraOn ? 'Turn camera capture off' : 'Turn camera capture on'}
          title={isCameraOn ? 'Turn camera capture off' : 'Turn camera capture on'}
          className={toolbarButton}
        >
          {isCameraOn ? (
            <CameraIcon className="h-4 w-4" />
          ) : (
            <CameraOffIcon className="h-4 w-4 text-recording" />
          )}
        </button>

        {showShareActions && onChangeSource && onStopSharing && (
          <div className="ml-1 flex items-center gap-0.5 border-l border-border-default pl-1.5">
            <ScreenShareActions
              onChangeSource={onChangeSource}
              onStopSharing={onStopSharing}
              compact={toolbarCompact}
            />
          </div>
        )}
      </div>
    </div>
  );
}
