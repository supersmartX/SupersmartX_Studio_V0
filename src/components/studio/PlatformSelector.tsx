'use client';

import { PLATFORM_PRESETS } from '@/constants';
import { isPlatformLockedForUser } from '@/lib/entitlements';
import type { PlatformId } from '@/types';

interface PlatformSelectorProps {
  selectedPlatformId: PlatformId;
  onSelect: (id: PlatformId) => void;
  layout?: 'inspector' | 'modal';
  isAuthenticated?: boolean;
  userPlan?: string;
  onUpgradeRequired?: () => void;
}

export function PlatformSelector({
  selectedPlatformId,
  onSelect,
  layout = 'inspector',
  isAuthenticated = true,
  userPlan = 'free',
  onUpgradeRequired,
}: PlatformSelectorProps) {
  const gridClass = layout === 'modal'
    ? 'grid grid-cols-2 sm:grid-cols-3 gap-2'
    : 'grid grid-cols-2 gap-1.5';

  const isLocked = (id: PlatformId) => isAuthenticated && isPlatformLockedForUser(id, userPlan);

  const handlePress = (id: PlatformId) => {
    if (isLocked(id)) {
      onUpgradeRequired?.();
      return;
    }
    onSelect(id);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {layout === 'inspector' && (
        <span className="text-[12px] font-medium text-text-secondary uppercase tracking-wider">Platform</span>
      )}
      <div className={gridClass} role="radiogroup" aria-label="Video platform">
        {PLATFORM_PRESETS.map((preset) => {
          const isActive = preset.id === selectedPlatformId;
          const locked = isLocked(preset.id);
          return (
            <button
              key={preset.id}
              role="radio"
              aria-checked={isActive}
              aria-disabled={locked}
              aria-label={locked ? `${preset.label}, Creator plan required` : undefined}
              onClick={() => handlePress(preset.id)}
              className={`group relative flex items-center gap-2.5 rounded-lg border transition-all duration-150 text-left min-h-[44px] ${
                layout === 'modal' ? 'p-3' : 'px-2.5 py-2'
              } ${
                isActive
                  ? 'shadow-sm'
                  : 'border-border-subtle bg-elevated hover:border-border-strong hover:bg-elevated'
              }`}
              style={isActive ? {
                borderColor: `${preset.color}66`,
                backgroundColor: `${preset.color}1a`,
              } : undefined}
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
                <span className="text-[12px] text-text-secondary leading-tight truncate">
                  {locked ? `${preset.sublabel} · Creator` : preset.sublabel}
                </span>
              </div>
              {isActive && (
                <div
                  className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: preset.color }}
                />
              )}
              {locked && (
                <div
                  className="absolute top-1.5 right-1.5 px-1 py-0.5 rounded bg-accent/20 text-accent text-[8px] font-bold tracking-wide"
                  title="Creator plan required"
                  aria-hidden="true"
                >
                  👑 CREATOR
                </div>
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
          isActive ? 'text-white shadow-sm' : 'text-text-secondary'
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
