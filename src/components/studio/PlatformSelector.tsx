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
  onUpgradeRequired?: (platformId: PlatformId) => void;
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
      onUpgradeRequired?.(id);
      return;
    }
    onSelect(id);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className={gridClass} role="radiogroup" aria-label="Publishing destination">
        {PLATFORM_PRESETS.map((preset) => {
          const isActive = preset.id === selectedPlatformId;
          const locked = isLocked(preset.id);
          return (
            <button
              key={preset.id}
              role="radio"
              aria-checked={isActive}
              aria-disabled={locked}
              aria-label={locked ? `${preset.label}, Creator plan required` : preset.label}
              onClick={() => handlePress(preset.id)}
              className={`group relative flex items-center gap-2.5 rounded-lg border transition-all duration-150 text-left min-h-[44px] ${
                layout === 'modal' ? 'p-3' : 'px-2.5 py-2'
              } ${
                locked
                  ? 'opacity-50 border-border-subtle bg-elevated/50 cursor-not-allowed'
                  : isActive
                    ? 'shadow-sm'
                    : 'border-border-subtle bg-elevated hover:border-border-strong hover:bg-elevated'
              }`}
              style={isActive && !locked ? {
                borderColor: `${preset.color}66`,
                backgroundColor: `${preset.color}1a`,
              } : undefined}
            >
              <PlatformIcon
                icon={preset.icon}
                color={preset.color}
                isActive={isActive}
                locked={locked}
                layout={layout}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`font-medium leading-tight truncate ${
                  layout === 'modal' ? 'text-[13px]' : 'text-[12px]'
                } ${isActive && !locked ? 'text-text-primary' : locked ? 'text-text-muted' : 'text-text-secondary group-hover:text-text-primary'}`}>
                  {preset.label}
                </span>
                <span className={`text-[11px] leading-tight truncate ${
                  locked ? 'text-text-muted' : 'text-text-muted'
                }`}>
                  {locked ? 'Creator plan' : preset.sublabel}
                </span>
              </div>
              {isActive && !locked && (
                <div
                  className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: preset.color }}
                />
              )}
              {locked && (
                <div className="absolute top-1.5 right-1.5 text-text-muted" aria-hidden="true">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
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
  isActive,
  locked,
  layout,
}: {
  icon: string;
  color: string;
  isActive: boolean;
  locked: boolean;
  layout: 'inspector' | 'modal';
}) {
  const size = layout === 'modal' ? 'w-9 h-9' : 'w-7 h-7';

  return (
    <div className={`flex-shrink-0 ${size} flex items-center justify-center`}>
      <div
        className={`w-full h-full rounded-md flex items-center justify-center text-[10px] font-bold tracking-tight transition-all duration-150 ${
          locked
            ? 'text-text-muted bg-overlay'
            : isActive
              ? 'text-white shadow-sm'
              : 'text-text-secondary'
        }`}
        style={{
          backgroundColor: locked ? undefined : isActive ? color : `${color}33`,
        }}
      >
        {icon}
      </div>
    </div>
  );
}
