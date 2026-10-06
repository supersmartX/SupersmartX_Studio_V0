'use client';

import type { TabType } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  CameraIcon,
  BookOpenIcon,
  PlusIcon,
  SettingsIcon,
} from '@/components/icons';

interface BottomNavProps {
  activePanel: TabType | 'record' | 'share';
  /** Pure panel/navigation switch. Never a session reset (FC-1.0 DC-3). */
  onPanelChange: (panel: TabType | 'record' | 'share') => void;
  /**
   * The EXPLICIT "New Video" action — the only compact-layout entry point
   * that starts a fresh creation session (mirrors the desktop rail's entry).
   */
  onNewVideo: () => void;
  onSettingsToggle: () => void;
}

export function BottomNav({
  activePanel,
  onPanelChange,
  onNewVideo,
  onSettingsToggle,
}: BottomNavProps) {
  return (
    <nav className="flex xl:hidden h-14 border-t border-border-subtle bg-surface items-center justify-around px-2 shrink-0 safe-area-bottom z-20" aria-label="Compact navigation">
      <Tooltip content="Studio" side="top">
        <button
          onClick={() => onPanelChange('studio')}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            activePanel === 'studio'
              ? 'text-accent'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-label="Studio"
          aria-current={activePanel === 'studio' ? 'page' : undefined}
        >
          <CameraIcon className="w-5 h-5" />
          <span className="text-[12px] font-medium">Studio</span>
        </button>
      </Tooltip>

      {/* DC-3: session reset must be an affordance LABELED "New Video",
          never smuggled in behind a nav tab called "Studio". Destructive to
          the session only — the previous take stays in the library. */}
      <Tooltip content="New Video" side="top">
        <button
          onClick={onNewVideo}
          className="flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center text-text-secondary hover:text-text-primary"
          aria-label="New Video"
        >
          <PlusIcon className="w-5 h-5" />
          <span className="text-[12px] font-medium">New Video</span>
        </button>
      </Tooltip>

      <Tooltip content="Recordings" side="top">
        <button
          onClick={() => onPanelChange('library')}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
              activePanel === 'library'
                ? 'text-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          aria-label="Recordings"
          aria-current={activePanel === 'library' ? 'page' : undefined}
        >
          <BookOpenIcon className="w-5 h-5" />
          <span className="text-[12px] font-medium">Recordings</span>
        </button>
      </Tooltip>

      <Tooltip content="Settings" side="top">
        <button
          onClick={onSettingsToggle}
          className="flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center text-text-secondary hover:text-text-primary"
          aria-label="Settings"
        >
          <SettingsIcon className="w-5 h-5" />
          <span className="text-[12px] font-medium">Settings</span>
        </button>
      </Tooltip>
    </nav>
  );
}
