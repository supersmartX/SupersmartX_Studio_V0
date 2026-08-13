'use client';

import { useEffect } from 'react';

interface UseKeyboardShortcutsProps {
  onRecordStop: () => void;
  onNudgeUp: () => void;
  onNudgeDown: () => void;
  onCloseDrawer: () => void;
  isRecording: boolean;
  canRecord: boolean;
  isDrawerVisible: boolean;
  showNudgeToast: (message: string) => void;
}

export function useKeyboardShortcuts({
  onRecordStop,
  onNudgeUp,
  onNudgeDown,
  onCloseDrawer,
  isRecording,
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
        if (isRecording || canRecord) {
          onRecordStop();
        }
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onNudgeUp();
        showNudgeToast('Nudged Up');
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onNudgeDown();
        showNudgeToast('Nudged Down');
      }

      if (e.key === 'Escape' && isDrawerVisible) {
        onCloseDrawer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onRecordStop, onNudgeUp, onNudgeDown, onCloseDrawer, isRecording, canRecord, isDrawerVisible, showNudgeToast]);
}
