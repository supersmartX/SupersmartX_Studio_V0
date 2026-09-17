'use client';

import { ReactNode, useRef, useEffect } from 'react';
import { EyeIcon } from '@/components/icons';
import type { AspectRatio, RecordingConfiguration } from '@/types';
import { ASPECT_RATIO_PRESETS } from '@/constants';

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
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRatio = reviewAspectRatio || aspectRatio;
  const preset = ASPECT_RATIO_PRESETS[activeRatio];
  const isVertical = activeRatio === '9:16' || activeRatio === '4:5';
  const isSquare = activeRatio === '1:1';
  const isReview = !!reviewVideoUrl;

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

  // Auto-play review video
  useEffect(() => {
    if (!isReview || !videoRef.current) return;
    const video = videoRef.current;
    video.currentTime = 0;
    video.play().catch(() => {});
  }, [isReview, reviewVideoUrl]);

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-canvas overflow-hidden">
      <div
        className={`relative ${isVertical ? 'h-full max-h-full' : isSquare ? 'h-full max-h-full aspect-square' : 'w-full max-w-5xl sm:h-full'} ${preset.cssClass} bg-canvas rounded-xl overflow-hidden ring-1 ring-white/[0.06]`}
        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)' }}
      >
        {/* Hidden recording canvas for actual video capture */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ display: 'none' }}
          aria-hidden="true"
        />

        {isReview ? (
          /* Review mode: show recorded video with platform aspect ratio */
          <video
            ref={videoRef}
            src={reviewVideoUrl}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            loop
            muted
          />
        ) : (
          children
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

        {/* Canvas dimensions indicator */}
        <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 z-20 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-white/80 text-[10px] font-medium tabular-nums">
          {recordingConfig.width} × {recordingConfig.height}
        </div>
      </div>
    </div>
  );
}
