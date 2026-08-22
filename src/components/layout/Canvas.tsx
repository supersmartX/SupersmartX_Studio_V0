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
}

export function Canvas({
  children,
  focusViewEnabled,
  onFocusViewToggle,
  aspectRatio,
  recordingConfig,
  onCanvasReady,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preset = ASPECT_RATIO_PRESETS[aspectRatio];
  const isVertical = aspectRatio === '9:16' || aspectRatio === '4:5';
  const isSquare = aspectRatio === '1:1';

  // Create and manage the recording canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas dimensions to match recording configuration
    canvas.width = recordingConfig.width;
    canvas.height = recordingConfig.height;

    // Notify parent that canvas is ready
    if (onCanvasReady) {
      onCanvasReady(canvas);
    }
  }, [recordingConfig.width, recordingConfig.height, onCanvasReady]);

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-2 sm:p-4 bg-canvas overflow-hidden">
      <div
        className={`relative ${isVertical ? 'h-full max-h-full' : isSquare ? 'h-full max-h-full aspect-square' : 'w-full max-w-5xl sm:h-full'} ${preset.cssClass} bg-canvas rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/5`}
      >
        {/* Hidden recording canvas for actual video capture */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ display: 'none' }}
          aria-hidden="true"
        />

        {children}

        {/* Focus View Toggle - moved to top-left to avoid Timer overlap at top-right */}
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

        {/* Canvas dimensions indicator */}
        <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 z-20 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white/60 text-[10px] font-medium">
          {recordingConfig.width} × {recordingConfig.height}
        </div>
      </div>
    </div>
  );
}
