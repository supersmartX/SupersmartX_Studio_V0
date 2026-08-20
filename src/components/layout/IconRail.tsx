'use client';

import type { TabType } from '@/types';
import {
  FileTextIcon,
  BookOpenIcon,
  BarChartIcon,
  CameraIcon,
  AudioIcon,
  MicrophoneOffIcon,
  EyeIcon,
  SettingsIcon,
  KeyboardIcon,
} from '@/components/icons';

interface IconRailProps {
  activePanel: TabType | 'record' | 'share';
  onPanelChange: (panel: TabType | 'record' | 'share') => void;
  isCameraInitialized: boolean;
  onCameraInitialize: () => void;
  isMicMuted: boolean;
  onMicToggle: () => void;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  onPreferencesToggle: () => void;
  onOpenTeleprompter: () => void;
  onShowShortcuts: () => void;
  onPricingClick: () => void;
}

export function IconRail({
  activePanel,
  onPanelChange,
  isCameraInitialized,
  onCameraInitialize,
  isMicMuted,
  onMicToggle,
  focusViewEnabled,
  onFocusViewToggle,
  onPreferencesToggle,
  onOpenTeleprompter,
  onShowShortcuts,
  onPricingClick,
}: IconRailProps) {

  return (
    <nav className="hidden lg:flex w-[200px] h-full border-r border-border-subtle bg-surface flex-col shrink-0 overflow-hidden" aria-label="Main navigation">
      {/* WORKSPACE */}
      <div className="flex flex-col gap-0.5 px-3 pt-4 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 px-2">Workspace</span>

        <button
          onClick={() => onPanelChange('studio')}
          className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            activePanel === 'studio'
              ? 'bg-accent/15 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <CameraIcon className="w-4 h-4" />
          Studio
        </button>

        <button
          onClick={() => onPanelChange('library')}
          className={`flex items-center justify-between px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            activePanel === 'library'
              ? 'bg-accent/15 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <BookOpenIcon className="w-4 h-4" />
            Library
          </span>
          <span className="text-[9px] font-semibold bg-accent/15 text-accent px-1.5 py-0.5 rounded">Soon</span>
        </button>

        <button
          onClick={() => onPanelChange('insights')}
          className={`flex items-center justify-between px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            activePanel === 'insights'
              ? 'bg-accent/15 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <BarChartIcon className="w-4 h-4" />
            Insights
          </span>
          <span className="text-[9px] font-semibold bg-accent/15 text-accent px-1.5 py-0.5 rounded">Soon</span>
        </button>
      </div>

      <div className="w-full h-px bg-border-subtle mx-3" style={{ width: 'calc(100% - 24px)' }} />

      {/* TOOLS */}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 px-2">Tools</span>

        <button
          onClick={onOpenTeleprompter}
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
        >
          <FileTextIcon className="w-4 h-4" />
          Teleprompter
        </button>

        <button
          onClick={onCameraInitialize}
          className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            isCameraInitialized
              ? 'text-success'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <CameraIcon className="w-4 h-4" />
          Camera
        </button>

        <button
          onClick={onMicToggle}
          className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            isMicMuted
              ? 'text-recording'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          }`}
        >
          {isMicMuted ? (
            <MicrophoneOffIcon className="w-4 h-4" />
          ) : (
            <AudioIcon className="w-4 h-4" />
          )}
          {isMicMuted ? 'Mic Muted' : 'Audio'}
        </button>

        <button
          onClick={onFocusViewToggle}
          className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            focusViewEnabled
              ? 'text-accent bg-accent/10'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <EyeIcon className="w-4 h-4" />
          Focus View
        </button>
      </div>

      <div className="w-full h-px bg-border-subtle mx-3" style={{ width: 'calc(100% - 24px)' }} />

      {/* SETTINGS */}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 px-2">Settings</span>

        <button
          onClick={onPreferencesToggle}
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
        >
          <SettingsIcon className="w-4 h-4" />
          Preferences
        </button>

        <button
          onClick={onShowShortcuts}
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
        >
          <KeyboardIcon className="w-4 h-4" />
          Shortcuts
        </button>
      </div>

      <div className="flex-1" />

      {/* Upgrade Card */}
      <div className="px-3 pb-4">
        <button
          onClick={onPricingClick}
          className="w-full bg-elevated border border-border-subtle rounded-xl p-3.5 flex flex-col gap-2 hover:bg-subtle hover:border-accent/30 transition-colors text-left group"
        >
          <p className="text-[11px] text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
            Upgrade to Pro
          </p>
          <p className="text-[10px] text-text-muted leading-relaxed">
            Unlock unlimited recording and 4K export.
          </p>
          <span className="text-[10px] font-semibold text-accent opacity-0 group-hover:opacity-100 transition-opacity">
            View plans &rarr;
          </span>
        </button>
      </div>
    </nav>
  );
}
