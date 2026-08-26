'use client';

import { ASPECT_RATIO_PRESETS } from '@/constants';
import type { AspectRatio } from '@/types';

interface CustomFormatProps {
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onWidthChange: (w: number) => void;
  onHeightChange: (h: number) => void;
}

const CUSTOM_RATIOS: AspectRatio[] = ['16:9', '9:16', '4:3', '1:1', '4:5'];

export function CustomFormat({
  aspectRatio,
  width,
  height,
  onAspectRatioChange,
  onWidthChange,
  onHeightChange,
}: CustomFormatProps) {
  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg bg-elevated border border-border-subtle">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Aspect Ratio</label>
        <div className="grid grid-cols-5 gap-1.5">
          {CUSTOM_RATIOS.map((ratio) => {
            const preset = ASPECT_RATIO_PRESETS[ratio];
            const isActive = aspectRatio === ratio;
            const dims = getPreviewDimensions(ratio);
            return (
              <button
                key={ratio}
                onClick={() => {
                  onAspectRatioChange(ratio);
                  onWidthChange(preset.width);
                  onHeightChange(preset.height);
                }}
                className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-center transition-all min-h-[44px] ${
                  isActive
                    ? 'bg-accent/15 border-accent/30 text-accent'
                    : 'bg-canvas border-border-subtle text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
                }`}
              >
                <div
                  className={`border-[1.5px] rounded-sm transition-colors ${
                    isActive ? 'border-accent' : 'border-text-muted/30'
                  }`}
                  style={{ width: dims.width, height: dims.height }}
                />
                <span className="text-[11px] font-medium leading-none">{ratio}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[10px] text-text-muted">Width</label>
          <input
            type="number"
            value={width}
            onChange={(e) => onWidthChange(Math.max(1, Number(e.target.value)))}
            className="bg-canvas border border-border-subtle rounded-md px-2.5 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors w-full min-h-[36px]"
          />
        </div>
        <div className="flex items-end pb-2.5 text-text-muted text-[11px]">×</div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[10px] text-text-muted">Height</label>
          <input
            type="number"
            value={height}
            onChange={(e) => onHeightChange(Math.max(1, Number(e.target.value)))}
            className="bg-canvas border border-border-subtle rounded-md px-2.5 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors w-full min-h-[36px]"
          />
        </div>
      </div>
    </div>
  );
}

function getPreviewDimensions(aspectRatio: string): { width: number; height: number } {
  const max = 18;
  switch (aspectRatio) {
    case '16:9': return { width: max, height: Math.round(max * 9 / 16) };
    case '9:16': return { width: Math.round(max * 9 / 16), height: max };
    case '4:3':  return { width: max, height: Math.round(max * 3 / 4) };
    case '1:1':  return { width: max, height: max };
    case '4:5':  return { width: Math.round(max * 4 / 5), height: max };
    default:     return { width: max, height: Math.round(max * 9 / 16) };
  }
}
