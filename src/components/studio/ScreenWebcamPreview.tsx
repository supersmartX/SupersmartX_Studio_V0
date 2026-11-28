'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebcamOverlaySettings } from '@/types';
import {
  FALLBACK_CANVAS_HEIGHT,
  FALLBACK_CANVAS_WIDTH,
  FALLBACK_CAMERA_ASPECT,
  WEBCAM_SCALE_STEP,
  clampOverlayCenter,
  clampScale,
  computeWebcamRect,
  fitContainRect,
} from '@/lib/recording/webcam-overlay';

interface ScreenWebcamPreviewProps {
  /**
   * The compositor canvas (created by useScreenCameraComposition). It is
   * mounted AS the preview, so what the user sees is pixel-identical to what
   * MediaRecorder captures.
   */
  canvasEl: HTMLCanvasElement | null;
  overlay: WebcamOverlaySettings;
  onOverlayChange: (patch: Partial<WebcamOverlaySettings>) => void;
  /** Camera frame aspect (width/height), matching what the compositor uses. */
  cameraAspect: number;
  /** Live screen share — the overlay frame only exists over a live canvas. */
  screenActive: boolean;
}

const MOVE_STEP = 0.01;
const MOVE_STEP_LARGE = 0.05;

/**
 * The Screen + Webcam composition surface: the compositor canvas as the
 * preview and the draggable/resizable webcam frame aligned EXACTLY over the
 * camera's position inside that canvas (both derive from computeWebcamRect).
 *
 * The frame is plain DOM on top of the canvas — it is never part of the
 * recorded pixels, so interacting with it mid-take cannot disturb the
 * recording. Its controls live in the WebcamToolbar tray BELOW this preview,
 * outside the platform frame, so no tool ever covers the recorded image.
 */
export function ScreenWebcamPreview({
  canvasEl,
  overlay,
  onOverlayChange,
  cameraAspect,
  screenActive,
}: ScreenWebcamPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originScale: number;
    mode: 'move' | 'resize';
  } | null>(null);

  // Measure the preview box so the canvas can be letterboxed (CSS "contain")
  // with exact pixel geometry — the overlay's % coordinates then map 1:1 onto
  // the recorded composition at any canvas size.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setBoxSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const canvasAspect =
    canvasEl && canvasEl.width > 0 && canvasEl.height > 0
      ? canvasEl.width / canvasEl.height
      : FALLBACK_CANVAS_WIDTH / FALLBACK_CANVAS_HEIGHT;
  const fit = fitContainRect(boxSize.width, boxSize.height, canvasAspect);

  // Mount the compositor's canvas element into the preview host.
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    if (canvasEl && canvasEl.parentElement !== host) {
      host.appendChild(canvasEl);
    }
    return () => {
      if (canvasEl && canvasEl.parentElement === host) {
        host.removeChild(canvasEl);
      }
    };
  }, [canvasEl]);

  const effectiveCameraAspect =
    Number.isFinite(cameraAspect) && cameraAspect > 0 ? cameraAspect : FALLBACK_CAMERA_ASPECT;

  // The overlay rect, expressed in % of the fitted canvas — the same
  // computeWebcamRect the compositor draws with, so preview == recording.
  const canvasW = canvasEl && canvasEl.width > 0 ? canvasEl.width : FALLBACK_CANVAS_WIDTH;
  const canvasH = canvasEl && canvasEl.height > 0 ? canvasEl.height : FALLBACK_CANVAS_HEIGHT;
  const rect = computeWebcamRect(canvasW, canvasH, overlay, effectiveCameraAspect);
  const rectStyle = {
    left: `${(rect.x / canvasW) * 100}%`,
    top: `${(rect.y / canvasH) * 100}%`,
    width: `${(rect.w / canvasW) * 100}%`,
    height: `${(rect.h / canvasH) * 100}%`,
  };

  const moveOverlay = useCallback(
    (x: number, y: number) => {
      const clamped = clampOverlayCenter(
        x,
        y,
        overlay.scale,
        overlay.shape,
        effectiveCameraAspect,
        canvasAspect,
      );
      onOverlayChange(clamped);
    },
    [overlay.scale, overlay.shape, effectiveCameraAspect, canvasAspect, onOverlayChange],
  );

  const handlePointerDown = useCallback(
    (mode: 'move' | 'resize') => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: overlay.x,
        originY: overlay.y,
        originScale: overlay.scale,
        mode,
      };
    },
    [overlay.x, overlay.y, overlay.scale],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      // The fitted canvas rect IS the canvas in display space: deltas in px
      // convert to normalized canvas units by dividing by its display size.
      const box = contentRef.current?.getBoundingClientRect();
      const displayWidth = box?.width || fit.w || 1;
      const displayHeight = box?.height || fit.h || 1;
      const dx = (event.clientX - drag.startX) / displayWidth;
      const dy = (event.clientY - drag.startY) / displayHeight;
      if (drag.mode === 'move') {
        moveOverlay(drag.originX + dx, drag.originY + dy);
      } else {
        // Bottom-right grip: dragging away from the top-left grows the frame.
        // Vertical movement dominates (the overlay height drives the scale).
        const growth = (dy * displayHeight) / displayHeight + (dx * displayWidth) / displayHeight / 2;
        onOverlayChange({ scale: clampScale(drag.originScale + growth) });
      }
    },
    [fit.h, fit.w, moveOverlay, onOverlayChange],
  );

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
      let handled = true;
      switch (event.key) {
        case 'ArrowLeft':
          moveOverlay(overlay.x - step, overlay.y);
          break;
        case 'ArrowRight':
          moveOverlay(overlay.x + step, overlay.y);
          break;
        case 'ArrowUp':
          moveOverlay(overlay.x, overlay.y - step);
          break;
        case 'ArrowDown':
          moveOverlay(overlay.x, overlay.y + step);
          break;
        case '+':
        case '=':
          onOverlayChange({ scale: clampScale(overlay.scale + WEBCAM_SCALE_STEP) });
          break;
        case '-':
        case '_':
          onOverlayChange({ scale: clampScale(overlay.scale - WEBCAM_SCALE_STEP) });
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    },
    [moveOverlay, onOverlayChange, overlay.x, overlay.y, overlay.scale],
  );

  return (
    <div ref={boxRef} className="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        ref={contentRef}
        data-testid="webcam-canvas-strip"
        className="relative"
        style={{
          width: fit.w > 0 ? `${fit.w}px` : undefined,
          height: fit.h > 0 ? `${fit.h}px` : undefined,
        }}
      >
        <div
          ref={canvasHostRef}
          className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full [&>canvas]:rounded-lg"
        />

        {screenActive && overlay.visible && (
          <div
            role="group"
            aria-label="Webcam overlay. Drag to move. Arrow keys nudge, plus and minus resize."
            tabIndex={0}
            data-testid="webcam-overlay-frame"
            onPointerDown={handlePointerDown('move')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleKeyDown}
            className="absolute z-20 cursor-move touch-none outline-offset-2 outline-transparent transition-[outline-color] hover:outline-white/40 focus-visible:outline-accent"
            style={{ ...rectStyle, borderRadius: overlay.shape === 'circle' ? '50%' : '12px' }}
          >
            {/* Resize grip — bottom-right. stopPropagation (via the pointer
                handlers being its own) keeps the move handler from also
                treating this as a drag of the frame. */}
            <div
              role="button"
              aria-label="Resize webcam"
              title="Drag to resize"
              onPointerDown={handlePointerDown('resize')}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              tabIndex={0}
              className="absolute -bottom-1 -right-1 z-10 h-5 w-5 cursor-nwse-resize touch-none rounded-full border border-white/40 bg-black/60 opacity-70 transition-opacity hover:opacity-100 focus:opacity-100"
            />
          </div>
        )}
      </div>
    </div>
  );
}
