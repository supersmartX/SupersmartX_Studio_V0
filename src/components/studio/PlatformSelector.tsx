'use client';

import { PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

interface PlatformSelectorProps {
  selectedPlatformId: PlatformId;
  onSelect: (id: PlatformId) => void;
}

export function PlatformSelector({ selectedPlatformId, onSelect }: PlatformSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] text-text-secondary">Platform</label>
      <div className="grid grid-cols-2 gap-2">
        {PLATFORM_PRESETS.map((preset) => {
          const isActive = preset.id === selectedPlatformId;
          return (
            <button
              key={preset.id}
              onClick={() => onSelect(preset.id)}
              className={`flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all ${
                isActive
                  ? 'bg-accent/15 border-accent/30 text-accent'
                  : 'bg-elevated border-border-subtle text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
              }`}
            >
              <PlatformPreview
                aspectRatio={preset.aspectRatio}
                isActive={isActive}
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-medium leading-tight truncate">{preset.label}</span>
                <span className="text-[11px] text-text-muted leading-tight">{preset.sublabel}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlatformPreview({ aspectRatio, isActive }: { aspectRatio: string; isActive: boolean }) {
  const dimensions = getPreviewDimensions(aspectRatio);

  return (
    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
      <div
        className={`border-[1.5px] rounded-sm transition-colors ${
          isActive ? 'border-accent' : 'border-text-muted/40'
        }`}
        style={{ width: dimensions.width, height: dimensions.height }}
      />
    </div>
  );
}

function getPreviewDimensions(aspectRatio: string): { width: number; height: number } {
  const max = 28;
  switch (aspectRatio) {
    case '16:9': return { width: max, height: Math.round(max * 9 / 16) };
    case '9:16': return { width: Math.round(max * 9 / 16), height: max };
    case '4:3':  return { width: max, height: Math.round(max * 3 / 4) };
    case '1:1':  return { width: max, height: max };
    case '4:5':  return { width: Math.round(max * 4 / 5), height: max };
    default:     return { width: max, height: Math.round(max * 9 / 16) };
  }
}
