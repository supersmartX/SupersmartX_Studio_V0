'use client';

import { useEffect } from 'react';

interface UseKeyboardShortcutsProps {
  onRecordStop: () => void;
  onRecordPause: () => void;
  onRecordResume: () => void;
  onMicToggle: () => void;
  onNudgeUp: () => void;
  onNudgeDown: () => void;
  onCloseDrawer: () => void;
  isRecording: boolean;
  isPaused: boolean;
  canRecord: boolean;
  isDrawerVisible: boolean;
  showNudgeToast: (message: string) => void;
}

export function useKeyboardShortcuts({
  onRecordStop,
  onRecordPause,
  onRecordResume,
  onMicToggle,
  onNudgeUp,
  onNudgeDown,
  onCloseDrawer,
  isRecording,
  isPaused,
  canRecord,
  isDrawerVisible,
  showNudgeToast,
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (target.isContentEditable || ['textarea', 'input', 'select'].includes(tag)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (isRecording) {
          onRecordStop();
        } else if (isPaused) {
          onRecordResume();
        } else if (canRecord) {
          onRecordStop();
        }
      }

      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (isRecording) onRecordPause();
        else if (isPaused) onRecordResume();
      }

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onMicToggle();
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onNudgeUp();
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onNudgeDown();
      }

      if (e.key === 'Escape' && isDrawerVisible) {
        onCloseDrawer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onRecordStop, onRecordPause, onRecordResume, onMicToggle, onNudgeUp, onNudgeDown, onCloseDrawer, isRecording, isPaused, canRecord, isDrawerVisible, showNudgeToast]);
}
