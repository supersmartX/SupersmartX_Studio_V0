'use client';

import { PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

interface PlatformSelectorProps {
  selectedPlatformId: PlatformId;
  onSelect: (id: PlatformId) => void;
  layout?: 'inspector' | 'modal';
}

export function PlatformSelector({ selectedPlatformId, onSelect, layout = 'inspector' }: PlatformSelectorProps) {
  const gridClass = layout === 'modal'
    ? 'grid grid-cols-2 sm:grid-cols-3 gap-2'
    : 'grid grid-cols-2 gap-1.5';

  return (
    <div className="flex flex-col gap-1.5">
      {layout === 'inspector' && (
        <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Platform</span>
      )}
      <div className={gridClass} role="radiogroup" aria-label="Video platform">
        {PLATFORM_PRESETS.map((preset) => {
          const isActive = preset.id === selectedPlatformId;
          return (
            <button
              key={preset.id}
              role="radio"
              aria-checked={isActive}
              onClick={() => onSelect(preset.id)}
              className={`group relative flex items-center gap-2.5 rounded-lg border transition-all duration-150 text-left min-h-[44px] ${
                layout === 'modal' ? 'p-3' : 'px-2.5 py-2'
              } ${
                isActive
                  ? 'border-[color:var(--platform-color)]/40 bg-[color:var(--platform-color)]/10 shadow-sm'
                  : 'border-border-subtle bg-elevated hover:border-white/10 hover:bg-white/[0.03]'
              }`}
              style={{ '--platform-color': preset.color } as React.CSSProperties}
            >
              <PlatformIcon
                icon={preset.icon}
                color={preset.color}
                aspectRatio={preset.aspectRatio}
                isActive={isActive}
                layout={layout}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`font-medium leading-tight truncate ${
                  layout === 'modal' ? 'text-[13px]' : 'text-[12px]'
                } ${isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
                  {preset.label}
                </span>
                <span className="text-[10px] text-text-muted leading-tight truncate">
                  {preset.sublabel}
                </span>
              </div>
              {isActive && (
                <div
                  className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: preset.color }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlatformIcon({
  icon,
  color,
  aspectRatio,
  isActive,
  layout,
}: {
  icon: string;
  color: string;
  aspectRatio: string;
  isActive: boolean;
  layout: 'inspector' | 'modal';
}) {
  const size = layout === 'modal' ? 'w-9 h-9' : 'w-7 h-7';

  return (
    <div className={`flex-shrink-0 ${size} flex items-center justify-center`}>
      <div
        className={`w-full h-full rounded-md flex items-center justify-center text-[10px] font-bold tracking-tight transition-all duration-150 ${
          isActive ? 'text-white shadow-sm' : 'text-white/70'
        }`}
        style={{
          backgroundColor: isActive ? color : `${color}33`,
        }}
      >
        {icon}
      </div>
    </div>
  );
}
