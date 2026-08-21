'use client';

import { ReactNode } from 'react';
import { EyeIcon } from '@/components/icons';
import type { AspectRatio } from '@/types';
import { ASPECT_RATIO_PRESETS } from '@/constants';

interface CanvasProps {
  children: ReactNode;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  aspectRatio: AspectRatio;
}

export function Canvas({
  children,
  focusViewEnabled,
  onFocusViewToggle,
  aspectRatio,
}: CanvasProps) {
  const preset = ASPECT_RATIO_PRESETS[aspectRatio];

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-2 sm:p-4 bg-canvas overflow-hidden">
      <div
        className={`relative w-full h-full max-w-5xl ${preset.cssClass} sm:aspect-auto sm:h-full bg-canvas rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/5`}
      >
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
      </div>
    </div>
  );
}
