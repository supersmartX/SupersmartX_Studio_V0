'use client';

import type { TabType } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  CameraIcon,
  BookOpenIcon,
  SettingsIcon,
} from '@/components/icons';

interface BottomNavProps {
  activePanel: TabType | 'record' | 'share';
  onPanelChange: (panel: TabType | 'record' | 'share') => void;
  onSettingsToggle: () => void;
}

export function BottomNav({
  activePanel,
  onPanelChange,
  onSettingsToggle,
}: BottomNavProps) {
  return (
    <nav className="flex md:hidden h-14 border-t border-border-subtle bg-surface items-center justify-around px-2 shrink-0 safe-area-bottom z-20" aria-label="Mobile navigation">
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
