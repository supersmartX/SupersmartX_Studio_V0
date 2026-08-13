'use client';

import { ReactNode } from 'react';
import { EyeIcon } from '@/components/icons';

interface CanvasProps {
  children: ReactNode;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
}

export function Canvas({
  children,
  focusViewEnabled,
  onFocusViewToggle,
}: CanvasProps) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-2 sm:p-4 bg-canvas overflow-hidden">
      <div className="relative w-full h-full max-w-5xl bg-canvas rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/5">
        {children}

        {/* Focus View Toggle */}
        <button
          onClick={onFocusViewToggle}
          className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
            focusViewEnabled
              ? 'bg-accent/20 text-accent border border-accent/30'
              : 'bg-black/60 backdrop-blur-sm text-white/80 hover:bg-black/80'
          }`}
        >
          <EyeIcon className="w-3.5 h-3.5" />
          Focus View
        </button>
      </div>
    </div>
  );
}
