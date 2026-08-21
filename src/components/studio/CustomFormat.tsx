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
        <label className="text-[13px] text-text-secondary">Aspect Ratio</label>
        <div className="flex gap-1.5">
          {CUSTOM_RATIOS.map((ratio) => {
            const preset = ASPECT_RATIO_PRESETS[ratio];
            const isActive = aspectRatio === ratio;
            return (
              <button
                key={ratio}
                onClick={() => {
                  onAspectRatioChange(ratio);
                  onWidthChange(preset.width);
                  onHeightChange(preset.height);
                }}
                className={`flex-1 py-1.5 px-2 rounded-md text-[12px] font-medium border transition-all ${
                  isActive
                    ? 'bg-accent/15 border-accent/30 text-accent'
                    : 'bg-canvas border-border-subtle text-text-secondary hover:bg-white/[0.04]'
                }`}
              >
                {ratio}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[11px] text-text-muted">Width</label>
          <input
            type="number"
            value={width}
            onChange={(e) => onWidthChange(Math.max(1, Number(e.target.value)))}
            className="bg-canvas border border-border-subtle rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent transition-colors w-full"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[11px] text-text-muted">Height</label>
          <input
            type="number"
            value={height}
            onChange={(e) => onHeightChange(Math.max(1, Number(e.target.value)))}
            className="bg-canvas border border-border-subtle rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent transition-colors w-full"
          />
        </div>
      </div>
    </div>
  );
}
