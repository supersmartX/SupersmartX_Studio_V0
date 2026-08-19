'use client';

import type { RecordingState, TabType } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  RecordIcon,
  FileTextIcon,
  CameraIcon,
  BookOpenIcon,
  SettingsIcon,
  HeartIcon,
} from '@/components/icons';

interface BottomNavProps {
  activePanel: TabType | 'record' | 'share';
  onPanelChange: (panel: TabType | 'record' | 'share') => void;
  recordingState: RecordingState;
  onRecordToggle: () => void;
  onSettingsToggle: () => void;
  onSupportClick: () => void;
  isCameraInitialized: boolean;
  onCameraInitialize: () => void;
}

export function BottomNav({
  activePanel,
  onPanelChange,
  recordingState,
  onRecordToggle,
  onSettingsToggle,
  onSupportClick,
  isCameraInitialized,
  onCameraInitialize,
}: BottomNavProps) {
  const isRecording = recordingState === 'recording' || recordingState === 'paused';

  return (
    <nav className="flex md:hidden h-14 border-t border-border-subtle bg-surface items-center justify-around px-2 shrink-0 safe-area-bottom z-20" aria-label="Mobile navigation">
      <Tooltip content="Studio" side="top">
        <button
          onClick={() => onPanelChange('studio')}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            activePanel === 'studio'
              ? 'text-accent'
              : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label="Studio"
        >
          <FileTextIcon className="w-5 h-5" />
          <span className="text-[9px] font-medium">Studio</span>
        </button>
      </Tooltip>

      <Tooltip content="Library" side="top">
        <button
          onClick={() => onPanelChange('library')}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            activePanel === 'library'
              ? 'text-accent'
              : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label="Library"
        >
          <BookOpenIcon className="w-5 h-5" />
          <span className="text-[9px] font-medium">Library</span>
        </button>
      </Tooltip>

      <Tooltip content={isRecording ? 'Stop Recording' : 'Start Recording'} side="top">
        <button
          onClick={onRecordToggle}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            isRecording
              ? 'text-recording'
              : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          <RecordIcon className={`w-6 h-6 ${isRecording ? 'animate-pulse-recording' : ''}`} />
          <span className="text-[9px] font-medium">{isRecording ? 'Stop' : 'Record'}</span>
        </button>
      </Tooltip>

      <Tooltip content={isCameraInitialized ? 'Camera Active' : 'Enable Camera'} side="top">
        <button
          onClick={onCameraInitialize}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center ${
            isCameraInitialized
              ? 'text-success'
              : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label={isCameraInitialized ? 'Camera Active' : 'Enable Camera'}
        >
          <CameraIcon className="w-5 h-5" />
          <span className="text-[9px] font-medium">Camera</span>
        </button>
      </Tooltip>

      <Tooltip content="Support" side="top">
        <button
          onClick={onSupportClick}
          className="flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center text-text-muted hover:text-text-secondary hover:bg-accent/10"
          aria-label="Support SupersmartX"
        >
          <HeartIcon className="w-5 h-5" />
          <span className="text-[9px] font-medium">Support</span>
        </button>
      </Tooltip>

      <Tooltip content="Settings" side="top">
        <button
          onClick={onSettingsToggle}
          className="flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[48px] min-h-[44px] justify-center text-text-muted hover:text-text-secondary"
          aria-label="Settings"
        >
          <SettingsIcon className="w-5 h-5" />
          <span className="text-[9px] font-medium">Settings</span>
        </button>
      </Tooltip>
    </nav>
  );
}
