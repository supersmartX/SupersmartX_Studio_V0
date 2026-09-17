'use client';

import { PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

interface PlatformPreviewSwitcherProps {
  selectedPlatformId: PlatformId;
  onSelect: (id: PlatformId) => void;
  /** When true, locked platforms show upgrade indicator instead of selecting */
  isLocked?: (id: PlatformId) => boolean;
  onLockedClick?: (id: PlatformId) => void;
}

export function PlatformPreviewSwitcher({
  selectedPlatformId,
  onSelect,
  isLocked,
  onLockedClick,
}: PlatformPreviewSwitcherProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
        Preview as
      </span>
      <div className="flex items-center gap-1.5 overflow-x-auto px-2 max-w-full scrollbar-none">
        {PLATFORM_PRESETS.filter((p) => p.id !== 'custom').map((preset) => {
          const isActive = preset.id === selectedPlatformId;
          const locked = isLocked?.(preset.id) ?? false;
          return (
            <button
              key={preset.id}
              onClick={() => {
                if (locked) {
                  onLockedClick?.(preset.id);
                } else {
                  onSelect(preset.id);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all duration-150 shrink-0 ${
                isActive
                  ? 'text-white shadow-sm'
                  : locked
                    ? 'bg-elevated text-text-muted border border-border-subtle hover:bg-elevated/80'
                    : 'bg-elevated text-text-secondary border border-border-subtle hover:text-text-primary hover:border-border-strong'
              }`}
              style={isActive ? { backgroundColor: preset.color } : undefined}
              title={locked ? `${preset.label} — Creator plan required` : preset.label}
            >
              <span className="text-[10px] font-bold">{preset.icon}</span>
              <span>{preset.label}</span>
              {locked && (
                <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
