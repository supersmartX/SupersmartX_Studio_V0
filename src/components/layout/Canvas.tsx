'use client';

import { ReactNode, useRef, useEffect, useState } from 'react';
import { EyeIcon, AudioIcon as SpeakerIcon, SpeakerMutedIcon } from '@/components/icons';
import type { AspectRatio, RecordingConfiguration } from '@/types';
import { getPreviewBoxContainerStyle, getPreviewBoxStyle } from '@/lib/composition';

interface CanvasProps {
  children: ReactNode;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  aspectRatio: AspectRatio;
  recordingConfig: RecordingConfiguration;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** When provided, Canvas shows this recorded video instead of children (review mode) */
  reviewVideoUrl?: string;
  reviewAspectRatio?: AspectRatio;
  /** Shared-geometry crop style for the review video (same math as export) */
  reviewVideoStyle?: React.CSSProperties;
  /**
   * Whether the recorded asset actually contains an audio track. The review
   * mute/unmute control only renders when there is sound to control — a
   * silent take must not advertise one.
   */
  reviewHasAudio?: boolean;
  /**
   * The dimensions capture is ACTUALLY running at (live MediaStream track
   * settings, or the probed dimensions of the take under review). When absent
   * (no stream yet), the badge falls back to the configured target and labels
   * it as configuration — never as a captured resolution.
   */
  captureSize?: { width: number; height: number } | null;
}

export function Canvas({
  children,
  focusViewEnabled,
  onFocusViewToggle,
  aspectRatio,
  recordingConfig,
  onCanvasReady,
  reviewVideoUrl,
  reviewAspectRatio,
  reviewVideoStyle,
  reviewHasAudio,
  captureSize,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRatio = reviewAspectRatio || aspectRatio;
  const isReview = !!reviewVideoUrl;
  // Review-player mute — deliberately independent from the microphone mute
  // (`isMicMuted`): one governs what the CAMERA captured, this one governs
  // playback of the recorded asset. They must never be wired together.
  const [reviewMuted, setReviewMuted] = useState(true);

  // Create and manage the recording canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = recordingConfig.width;
    canvas.height = recordingConfig.height;

    if (onCanvasReady) {
      onCanvasReady(canvas);
    }
  }, [recordingConfig.width, recordingConfig.height, onCanvasReady]);

  // Auto-play review video. Attempt playback AUDIBLE first; browsers that
  // block unmuted playback without a user gesture fall back to muted — the
  // visible sound toggle below supplies exactly that gesture, so the review
  // can never be stranded silently muted with no way to hear it.
  useEffect(() => {
    if (!isReview || !videoRef.current) return;
    const video = videoRef.current;
    video.currentTime = 0;
    video.muted = false;
    setReviewMuted(false);
    video.play().catch(() => {
      video.muted = true;
      setReviewMuted(true);
      video.play().catch(() => {});
    });
  }, [isReview, reviewVideoUrl]);

  // Single writer of the element's mute property (mirrors useMicMuteSync's
  // role for track.enabled): the button state and playback can't diverge.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = reviewMuted;
  }, [reviewMuted, reviewVideoUrl]);

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
        className="relative bg-canvas rounded-xl overflow-hidden ring-1 ring-white/[0.06]"
        style={{
          ...getPreviewBoxStyle(activeRatio),
          boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        {/* Hidden recording canvas for actual video capture */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ display: 'none' }}
          aria-hidden="true"
        />

        {isReview ? (
          /* Review mode: show recorded video with platform aspect ratio.
             The style carries the shared export crop geometry (centered
             cover today); the box shape + video crop change together. */
          <video
            ref={videoRef}
            src={reviewVideoUrl}
            style={reviewVideoStyle}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            loop
          />
        ) : (
          children
        )}

        {/* Review sound control — only when the asset actually has audio.
             This is the affordance that makes muted-by-policy playback
             audible (one tap = the gesture autoplay policy wants). It has
             nothing to do with the microphone's recording mute. */}
        {isReview && reviewHasAudio && (
          <button
            onClick={() => setReviewMuted((m) => !m)}
            aria-label={reviewMuted ? 'Unmute review playback' : 'Mute review playback'}
            aria-pressed={!reviewMuted}
            className="absolute top-2 left-2 sm:top-3 sm:left-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white text-[11px] font-medium transition-colors min-w-[44px] min-h-[44px] justify-center"
          >
            {reviewMuted ? <SpeakerMutedIcon className="w-4 h-4" /> : <SpeakerIcon className="w-4 h-4" />}
            <span>{reviewMuted ? 'Turn sound on' : 'Turn sound off'}</span>
          </button>
        )}

        {/* Focus View Toggle - moved to top-left to avoid Timer overlap at top-right */}
        {!isReview && (
          <button
            onClick={onFocusViewToggle}
            className={`absolute top-2 left-2 sm:top-3 sm:left-3 z-20 flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors min-w-[44px] min-h-[44px] justify-center ${
              focusViewEnabled
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-black/60 backdrop-blur-sm text-white/80 hover:bg-black/80'
            }`}
          >
            <EyeIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Focus View</span>
          </button>
        )}

        {/* Capture dimensions badge. With a live capture (or a take under
            review) it reports the ACTUAL dimensions; before capture it shows
            the configured target, explicitly labelled as configuration so the
            UI never claims a resolution the stream is not delivering. */}
        <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 z-20 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-white/80 text-[10px] font-medium tabular-nums">
          {captureSize && captureSize.width > 0 && captureSize.height > 0
            ? `${captureSize.width} × ${captureSize.height}`
            : `Target ${recordingConfig.width} × ${recordingConfig.height}`}
        </div>
      </div>
    </div>
  );
}
