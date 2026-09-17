'use client';

import type { TabType } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  CameraIcon,
  BookOpenIcon,
  KeyboardIcon,
} from '@/components/icons';

interface IconRailProps {
  activePanel: TabType | 'record' | 'share';
  onPanelChange: (panel: TabType | 'record' | 'share') => void;
  onShowShortcuts: () => void;
}

export function IconRail({
  activePanel,
  onPanelChange,
  onShowShortcuts,
}: IconRailProps) {
  return (
    <nav className="hidden lg:flex w-[200px] h-full border-r border-border-subtle bg-surface flex-col shrink-0 overflow-hidden" aria-label="Main navigation">
      <div className="flex flex-col gap-0.5 px-3 pt-5 pb-2">
        <span className="text-[11px] font-medium text-text-muted mb-2 px-2">Studio</span>

        <Tooltip content="Record a new video" side="right">
          <button
            onClick={() => onPanelChange('studio')}
            aria-current={activePanel === 'studio' ? 'page' : undefined}
            className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              activePanel === 'studio'
                ? 'bg-accent/15 text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
            }`}
          >
            <CameraIcon className="w-4 h-4" />
            New Video
          </button>
        </Tooltip>

        <Tooltip content="View saved recordings" side="right">
          <button
            onClick={() => onPanelChange('library')}
            aria-current={activePanel === 'library' ? 'page' : undefined}
            className={`flex items-center justify-between px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              activePanel === 'library'
                ? 'bg-accent/15 text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <BookOpenIcon className="w-4 h-4" />
              Recordings
            </span>
          </button>
        </Tooltip>
      </div>

      <div className="w-full h-px bg-border-subtle mx-3" style={{ width: 'calc(100% - 24px)' }} />

      <div className="flex flex-col gap-0.5 px-3 py-2">
        <span className="text-[11px] font-medium text-text-muted mb-2 px-2">Help</span>

        <Tooltip content="View keyboard shortcuts" side="right">
          <button
            onClick={onShowShortcuts}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <KeyboardIcon className="w-4 h-4" />
            Shortcuts
          </button>
        </Tooltip>
      </div>

      <div className="flex-1" />
    </nav>
  );
}
