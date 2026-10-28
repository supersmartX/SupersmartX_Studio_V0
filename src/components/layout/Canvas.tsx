'use client';

import { ReactNode } from 'react';
import { EyeIcon } from '@/components/icons';
import { ReviewPlayer } from '@/components/studio/ReviewPlayer';
import type { AspectRatio } from '@/types';
import { getPreviewBoxContainerStyle, getPreviewBoxStyle } from '@/lib/composition';

interface CanvasProps {
  children: ReactNode;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  aspectRatio: AspectRatio;
  /** When provided, Canvas shows this recorded video instead of children (review mode) */
  reviewVideoUrl?: string;
  reviewAspectRatio?: AspectRatio;
  /** Shared-geometry crop style for the review video (same math as export) */
  reviewVideoStyle?: React.CSSProperties;
  /**
   * The take's real length. MediaRecorder blobs report a non-finite
   * `video.duration` until the last fragment is read, so the review transport
   * needs the recorded length to size its clock and scrubber.
   */
  reviewDuration?: number;
  /**
   * Single-audible-player discipline: the review take plays only while its
   * surface is the foreground (studio panel visible, export drawer closed).
   * Navigating to the library or opening export pauses it; returning resumes.
   * Defaults to true so existing usages are unaffected.
   */
  reviewActive?: boolean;
  /**
   * Whether the recorded asset actually contains an audio track. The review
   * mute/unmute control only renders when there is sound to control — a
   * silent take must not advertise one.
   */
  reviewHasAudio?: boolean;
  /**
   * Live-state pill (recording / paused) rendered in the same top rail as the
   * Focus View control. One rail instead of two stacked rows keeps the
   * teleprompter's safe area at 64px, which matters on a ~200px-tall phone
   * preview box.
   */
  statusBadge?: ReactNode;
}

export function Canvas({
  children,
  focusViewEnabled,
  onFocusViewToggle,
  aspectRatio,
  reviewVideoUrl,
  reviewAspectRatio,
  reviewVideoStyle,
  reviewDuration,
  reviewActive = true,
  reviewHasAudio,
  statusBadge,
}: CanvasProps) {
  const activeRatio = reviewAspectRatio || aspectRatio;
  const isReview = !!reviewVideoUrl;

  return (
    <div
      className="flex-1 min-h-0 flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-canvas overflow-hidden"
      style={getPreviewBoxContainerStyle()}
    >
      <div
        /* The box IS the platform's frame. Its shape is set by
           getPreviewBoxStyle (min of both axes + the exact ratio) rather than
           by `w-full`/`h-full` + aspect-*, because those make `aspect-ratio`
           inert and let the box take the container's ratio — which silently
           changed the composition relative to the export. */
        /* `isolate` is load-bearing: without it every layer inside this box
           (guides, countdown, the camera-init prompt) competes in the page's
           single stacking context, so an inner `z-40` painted straight over the
           `z-header: 30` app bar and blocked whatever the bar drops over the
           canvas — the compact menu's items, the user menu. Scoping the canvas
           keeps its internal order intact while chrome stays on top; modals,
           the drawer and the toast sit outside this box and still win, as their
           tokens require. */
        className="relative isolate bg-canvas rounded-xl overflow-hidden ring-1 ring-white/[0.06]"
        style={{
          ...getPreviewBoxStyle(activeRatio),
          boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        {isReview ? (
          /* Review mode: the recorded take, with its own transport (play,
             pause, scrub, restart, sound). The box shape carries the shared
             export crop geometry, so the frame and the file agree. */
          <ReviewPlayer
            videoUrl={reviewVideoUrl!}
            videoStyle={reviewVideoStyle}
            recordedDuration={reviewDuration}
            hasAudio={!!reviewHasAudio}
            isActive={reviewActive}
          />
        ) : (
          children
        )}

        {/* Focus View Toggle + live-state pill — one top-left rail. The rail,
            not the button, owns the offset so the pill can sit beside the
            control instead of adding a second row over the script. */}
        {!isReview && (
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-20 flex items-center gap-2">
            <button
              onClick={onFocusViewToggle}
              aria-label="Focus View"
              aria-pressed={focusViewEnabled}
              title="Focus View"
              className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-full text-[11px] font-medium backdrop-blur-md transition-colors min-w-[44px] min-h-[44px] justify-center ${
                focusViewEnabled
                  ? 'bg-accent/25 text-white ring-1 ring-accent/40'
                  : 'bg-black/25 text-white/70 hover:bg-black/40 hover:text-white ring-1 ring-white/[0.06]'
              }`}
            >
              <EyeIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Focus View</span>
            </button>
            {statusBadge}
          </div>
        )}

        {/* Capture-dimensions chip removed (clean-canvas redesign): a permanent
            "1920 × 1080" read-out was technical dashboard, not creator
            information. Real geometry still surfaces where it earns its place —
            the RecordingStatusLine during a take (track settings), the review
            preset row under the canvas (platform + take dimensions). */}
      </div>
    </div>
  );
}
