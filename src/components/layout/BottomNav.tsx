'use client';

import type { RecordingState, TabType } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  RecordIcon,
  PauseIcon,
  PlayIcon,
  FileTextIcon,
  CameraIcon,
  BookOpenIcon,
  SettingsIcon,
} from '@/components/icons';

interface BottomNavProps {
  activePanel: TabType | 'record' | 'share';
  onPanelChange: (panel: TabType | 'record' | 'share') => void;
  recordingState: RecordingState;
  onRecordToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onSettingsToggle: () => void;
  onPricingClick: () => void;
  isCameraInitialized: boolean;
  isCameraRequesting: boolean;
  onCameraInitialize: () => void;
  userPlan?: string;
}

export function BottomNav({
  activePanel,
  onPanelChange,
  recordingState,
  onRecordToggle,
  onPause,
  onResume,
  onSettingsToggle,
  onPricingClick,
  isCameraInitialized,
  isCameraRequesting,
  onCameraInitialize,
  userPlan = 'free',
}: BottomNavProps) {
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const isBusy = isRecording || isPaused;
  const isPaid = userPlan === 'creator_monthly' || userPlan === 'creator_yearly' || userPlan === 'pro_monthly' || userPlan === 'pro_yearly';
  const isPro = userPlan === 'pro_monthly' || userPlan === 'pro_yearly';

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
          <FileTextIcon className="w-5 h-5" />
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

      <Tooltip content={isBusy ? (isRecording ? 'Pause Recording' : 'Resume Recording') : 'Start Recording'} side="top">
        <button
          onClick={isRecording ? onPause : isPaused ? onResume : onRecordToggle}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            isBusy
              ? 'text-recording'
              : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-label={isRecording ? 'Pause Recording' : isPaused ? 'Resume Recording' : 'Start Recording'}
        >
          {isRecording ? (
            <PauseIcon className="w-6 h-6" />
          ) : isPaused ? (
            <PlayIcon className="w-6 h-6" />
          ) : (
            <RecordIcon className="w-6 h-6" />
          )}
          <span className="text-[12px] font-medium">{isRecording ? 'Pause' : isPaused ? 'Resume' : 'Record'}</span>
        </button>
      </Tooltip>

      {isBusy && (
        <Tooltip content="Stop Recording" side="top">
          <button
            onClick={onRecordToggle}
            className="flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center text-text-secondary hover:text-recording"
            aria-label="Stop Recording"
          >
            <div className="w-5 h-5 rounded-sm bg-current" />
            <span className="text-[12px] font-medium">Stop</span>
          </button>
        </Tooltip>
      )}

      <Tooltip content={isCameraRequesting ? 'Initializing camera...' : isCameraInitialized ? 'Camera Active' : 'Enable Camera'} side="top">
        <button
          onClick={onCameraInitialize}
          disabled={isCameraRequesting}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            isCameraRequesting
              ? 'text-warning'
              : isCameraInitialized
                ? 'text-success'
                : 'text-text-secondary hover:text-text-primary'
          }`}
          aria-label={isCameraRequesting ? 'Initializing camera' : isCameraInitialized ? 'Camera Active' : 'Enable Camera'}
        >
          {isCameraRequesting ? (
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <CameraIcon className="w-5 h-5" />
          )}
          <span className="text-[12px] font-medium">{isCameraRequesting ? 'Loading' : 'Camera'}</span>
        </button>
      </Tooltip>

      <Tooltip content={isPaid ? (isPro ? 'Pro Active' : 'Creator Active') : 'Upgrade'} side="top">
        <button
          onClick={onPricingClick}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            isPaid
              ? 'text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-accent/10'
          }`}
          aria-label={isPaid ? (isPro ? 'Pro Plan Active' : 'Creator Plan Active') : 'Upgrade'}
        >
          <div className="relative">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
            {isPaid && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-accent rounded-full" />
            )}
          </div>
          <span className="text-[12px] font-medium">{isPaid ? (isPro ? 'Pro' : 'Creator') : 'Upgrade'}</span>
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
