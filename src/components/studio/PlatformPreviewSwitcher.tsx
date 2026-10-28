'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

interface PlatformPreviewSwitcherProps {
  selectedPlatformId: PlatformId;
  onSelect: (id: PlatformId) => void;
  /** When true, locked platforms show upgrade indicator instead of selecting */
  isLocked?: (id: PlatformId) => boolean;
  onLockedClick?: (id: PlatformId) => void;
  /**
   * Caption above the chips. The single source of platform selection for both
   * workflows — Studio review and the library's existing-recording view — so it
   * must never be duplicated with a second selector.
   */
  label?: string;
  /** Denser spacing for the review overlay, where vertical room is precious. */
  compact?: boolean;
}

export function PlatformPreviewSwitcher({
  selectedPlatformId,
  onSelect,
  isLocked,
  onLockedClick,
  label = 'Preview as',
  compact = false,
}: PlatformPreviewSwitcherProps) {
  // The chip row scrolls horizontally on phones. Without a visible cue the
  // clipped chip at the right edge just looked broken; the fade appears
  // whenever there is more row to reach and leaves once it is all on screen.
  const rowRef = useRef<HTMLDivElement>(null);
  const [moreToRight, setMoreToRight] = useState(false);

  const updateOverflow = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setMoreToRight(row.scrollWidth - row.clientWidth - row.scrollLeft > 2);
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    updateOverflow();
    row.addEventListener('scroll', updateOverflow, { passive: true });
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(row);
    window.addEventListener('resize', updateOverflow);
    return () => {
      row.removeEventListener('scroll', updateOverflow);
      observer.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [updateOverflow, selectedPlatformId]);

  return (
    <div
      data-platform-switcher
      className={`flex items-center ${compact ? 'gap-2 py-0' : 'flex-col gap-2 py-3'}`}
    >
      <span className="shrink-0 text-[11px] font-medium text-text-muted uppercase tracking-wider">
        {label}
      </span>
      {/* py-[7px] keeps each chip's ±7px hit-expansion inside this
          overflow-x-auto row — computed overflow-y would clip it otherwise.
          The visible pill stays compact (30–32px), but the tappable area is
          ≥44px tall, matching the primary review actions. */}
      <div className={`relative min-w-0 ${compact ? 'flex-1' : 'w-full'}`}>
        <div
          ref={rowRef}
          className="flex min-w-0 items-center gap-1.5 overflow-x-auto px-2 py-[7px] max-w-full scrollbar-none"
        >
          {LAUNCH_PLATFORM_PRESETS.map((preset) => {
            const isActive = preset.id === selectedPlatformId;
            const locked = isLocked?.(preset.id) ?? false;
            // Selection used to be conveyed by colour alone, which is invisible
            // to a screen reader (and to anyone who cannot tell the fills apart).
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
                className={`flex items-center gap-1.5 px-3 py-1.5 relative after:absolute after:-inset-y-[7px] after:inset-x-0 after:content-[''] rounded-full text-[12px] font-medium whitespace-nowrap transition-all duration-150 shrink-0 ${
                  isActive
                    ? 'text-white shadow-sm'
                    : locked
                      ? 'bg-elevated text-text-muted border border-border-subtle hover:bg-elevated/80'
                      : 'bg-elevated text-text-secondary border border-border-subtle hover:text-text-primary hover:border-border-strong'
                }`}
                style={isActive ? { backgroundColor: preset.color } : undefined}
                aria-pressed={isActive}
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
        {moreToRight && (
          <div
            data-scroll-cue
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent"
          />
        )}
      </div>
    </div>
  );
}
