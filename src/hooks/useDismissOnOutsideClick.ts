'use client';

import { useEffect, type RefObject } from 'react';

// Dismisses safe temporary UI (menus, tooltips, popovers) on outside click
// or Escape. Never use for critical confirmations, permission dialogs, or
// anything that would interrupt recording/export — those require explicit
// user action.
export function useDismissOnOutsideClick(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onDismiss();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onDismiss, ref]);
}
