'use client';

import type { TabType } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
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
  isCameraRequesting: boolean;
  onCameraInitialize: () => void;
  isMicMuted: boolean;
  onMicToggle: () => void;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  onPreferencesToggle: () => void;
  onOpenTeleprompter: () => void;
  onShowShortcuts: () => void;
  onPricingClick: () => void;
  userPlan?: string;
}

export function IconRail({
  activePanel,
  onPanelChange,
  isCameraInitialized,
  isCameraRequesting,
  onCameraInitialize,
  isMicMuted,
  onMicToggle,
  focusViewEnabled,
  onFocusViewToggle,
  onPreferencesToggle,
  onOpenTeleprompter,
  onShowShortcuts,
  onPricingClick,
  userPlan = 'free',
}: IconRailProps) {
  const isPaid = userPlan === 'creator_monthly' || userPlan === 'creator_yearly' || userPlan === 'pro_monthly' || userPlan === 'pro_yearly';
  const isPro = userPlan === 'pro_monthly' || userPlan === 'pro_yearly';

  return (
    <nav className="hidden lg:flex w-[200px] h-full border-r border-border-subtle bg-surface flex-col shrink-0 overflow-hidden" aria-label="Main navigation">
      {/* WORKSPACE */}
      <div className="flex flex-col gap-0.5 px-3 pt-4 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary mb-2 px-2">Workspace</span>

        <Tooltip content="Open camera studio" side="right">
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
            Studio
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

        <Tooltip content="Analytics coming soon" side="right">
          <span
            className="flex items-center justify-between px-2 py-2 rounded-lg text-[13px] font-medium text-text-muted/50 cursor-not-allowed select-none"
            aria-disabled="true"
          >
            <span className="flex items-center gap-2.5">
              <BarChartIcon className="w-4 h-4 opacity-50" />
              Insights
            </span>
            <span className="text-[9px] font-semibold bg-accent/10 text-accent/60 px-1.5 py-0.5 rounded">Soon</span>
          </span>
        </Tooltip>
      </div>

      <div className="w-full h-px bg-border-subtle mx-3" style={{ width: 'calc(100% - 24px)' }} />

      {/* TOOLS */}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary mb-2 px-2">Tools</span>

        <Tooltip content="Open teleprompter editor" side="right">
          <button
            onClick={onOpenTeleprompter}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <FileTextIcon className="w-4 h-4" />
            Teleprompter
          </button>
        </Tooltip>

        <Tooltip content={isCameraRequesting ? 'Initializing camera...' : isCameraInitialized ? 'Camera is active' : 'Enable camera'} side="right">
          <button
            onClick={onCameraInitialize}
            disabled={isCameraRequesting}
            aria-pressed={isCameraInitialized}
            className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              isCameraRequesting
                ? 'text-warning'
                : isCameraInitialized
                  ? 'text-success'
                  : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
            }`}
          >
            {isCameraRequesting ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <CameraIcon className="w-4 h-4" />
            )}
            Camera
          </button>
        </Tooltip>

        <Tooltip content={isMicMuted ? 'Unmute microphone' : 'Mute microphone'} side="right">
          <button
            onClick={onMicToggle}
            aria-pressed={isMicMuted}
            aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
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
        </Tooltip>

        <Tooltip content={focusViewEnabled ? 'Disable focus view' : 'Enable focus view'} side="right">
          <button
            onClick={onFocusViewToggle}
            aria-pressed={focusViewEnabled}
            className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              focusViewEnabled
                ? 'text-accent bg-accent/10'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
            }`}
          >
            <EyeIcon className="w-4 h-4" />
            Focus View
          </button>
        </Tooltip>
      </div>

      <div className="w-full h-px bg-border-subtle mx-3" style={{ width: 'calc(100% - 24px)' }} />

      {/* SETTINGS */}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary mb-2 px-2">Settings</span>

        <Tooltip content="Open preferences panel" side="right">
          <button
            onClick={onPreferencesToggle}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <SettingsIcon className="w-4 h-4" />
            Preferences
          </button>
        </Tooltip>

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

      {/* Upgrade Card */}
      <div className="px-3 pb-4">
        {isPaid ? (
          <div className="w-full bg-accent/10 border border-accent/20 rounded-xl p-3.5 flex flex-col gap-1.5 text-left">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-accent bg-accent/20 px-1.5 py-0.5 rounded">{isPro ? 'PRO' : 'CREATOR'}</span>
              <span className="text-[11px] font-medium text-text-primary">Active</span>
            </div>
            <p className="text-[12px] text-text-secondary">
              {isPro ? '4K export & batch processing' : 'Up to 30 min per video & 1080p'}
            </p>
          </div>
        ) : (
          <button
            onClick={onPricingClick}
            className="w-full bg-elevated border border-border-subtle rounded-xl p-3.5 flex flex-col gap-2 hover:bg-subtle hover:border-accent/30 transition-colors text-left group"
          >
            <p className="text-[13px] text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
              Upgrade to Creator
            </p>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              Up to 30 min per video &amp; 1080p export.
            </p>
            <span className="text-[10px] font-semibold text-accent opacity-0 group-hover:opacity-100 transition-opacity">
              View plans &rarr;
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
