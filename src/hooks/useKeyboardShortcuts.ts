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
  /**
   * The ↑/↓ nudge scrolls the TELEPROMPTER. With an empty script there is
   * nothing to scroll, and hijacking the arrow keys anyway stole them from
   * normal page/scroll behaviour for nothing.
   */
  canNudge: boolean;
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
  canNudge,
  showNudgeToast,
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (target.isContentEditable || ['textarea', 'input', 'select'].includes(tag)) return;

      if (e.code === 'Space') {
        // Space is the native activator for buttons and links — never steal it
        // from an interactive element or an open dialog/menu, or the control
        // the user is focused on silently stops working (WCAG 2.1.1).
        if (
          tag === 'button' ||
          tag === 'a' ||
          target.closest('[role="dialog"], [role="menu"], [role="toolbar"]')
        ) return;
        e.preventDefault();
        if (isRecording) {
          onRecordStop();
        } else if (isPaused) {
          onRecordResume();
        } else if (canRecord) {
          onRecordStop();
        }
      }

      // P and M act on the studio underneath. Inside an open dialog/menu the
      // user is talking TO that surface, so the keys stay theirs.
      if (target.closest('[role="dialog"], [role="menu"]')) return;

      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (isRecording) onRecordPause();
        else if (isPaused) onRecordResume();
      }

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onMicToggle();
      }

      // ↑/↓ nudge the TELEPROMPTER — only when there is a script to scroll,
      // never inside a dialog/menu (where the arrows belong to that surface),
      // and never as page-scroll suppression for nothing.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!canNudge) return;
        if (target.closest('[role="dialog"], [role="menu"]')) return;
        e.preventDefault();
        if (e.key === 'ArrowUp') onNudgeUp();
        else onNudgeDown();
      }

      if (e.key === 'Escape' && isDrawerVisible) {
        onCloseDrawer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onRecordStop, onRecordPause, onRecordResume, onMicToggle, onNudgeUp, onNudgeDown, onCloseDrawer, isRecording, isPaused, canRecord, isDrawerVisible, canNudge]);
}
