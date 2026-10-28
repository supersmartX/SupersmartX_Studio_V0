'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  maxWidth?: string;
  ariaLabel?: string;
  /**
   * `alertdialog` for destructive confirmations, which must interrupt the
   * user; plain dialogs keep the default `dialog` role.
   */
  role?: 'dialog' | 'alertdialog';
}

/**
 * Mount order of the currently-open modals, oldest first.
 *
 * Every Modal listens for Escape on the document, so two mounted at once (an
 * upgrade prompt raised from inside the library's existing-recording view) both
 * see the same keydown and one Escape would dismiss the whole stack — throwing
 * the user out of the view they opened the prompt from. Only the last entry is
 * allowed to react, which is the one actually on top.
 */
const openModals: symbol[] = [];

export function Modal({ isOpen, onClose, children, title, maxWidth = 'max-w-lg', ariaLabel, role = 'dialog' }: ModalProps) {
  const { isClosing, shouldRender, handleClose, swipeHandlers } = useModalAnimation(isOpen, onClose);
  const contentRef = useRef<HTMLDivElement>(null);
  // The control that opened this dialog, so closing returns focus to it.
  // Without this, dismissing a dialog dumped keyboard focus back onto <body>
  // and the user had to tab all the way back to where they were.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // UX-012: this used to focus `focusable[0]`, and because the header's Close
  // button is rendered BEFORE {children}, that was ALWAYS the Close button —
  // so opening a dialog focused "leave this dialog" instead of the task. Three
  // rules, in order:
  //   1. an explicit [data-modal-initial-focus] opt-out/opt-in, so a dialog can
  //      name its own primary control;
  //   2. otherwise the first focusable that is not the header Close;
  //   3. otherwise the first focusable (e.g. a dialog whose only control is Close).
  // Close stays in the DOM, in tab order, and Escape/trap/restore are untouched.
  // Capture the trigger when the dialog opens; hand focus back when it is gone.
  // Runs on the same `shouldRender` latch as the focus-in effect below, so the
  // trigger is recorded before anything inside the dialog takes focus.
  useEffect(() => {
    if (shouldRender) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      return;
    }
    // Closed: only pull focus back if it would otherwise be lost (i.e. it is
    // still on <body> or a detached node), so we never steal focus from a
    // dialog that opened on top of this one.
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    const active = document.activeElement;
    const focusIsLost = active === null || active === document.body || active === document.documentElement || !active.isConnected;
    if (target && target.isConnected && focusIsLost) {
      target.focus();
    }
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !contentRef.current) return;
    const root = contentRef.current;

    const explicit = root.querySelector<HTMLElement>('[data-modal-initial-focus]');
    // A disabled marker cannot take focus and must not end the search.
    if (explicit && !explicit.hasAttribute('disabled')) {
      explicit.focus();
      return;
    }

    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusable.length === 0) return;

    const firstTaskControl =
      focusable.find((el) => el.getAttribute('aria-label') !== 'Close') ?? focusable[0];
    firstTaskControl.focus();
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    const container = contentRef.current;
    if (!container) return;
    const token = Symbol('modal');
    openModals.push(token);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Not the topmost modal: let the one above it handle this key.
        if (openModals[openModals.length - 1] !== token) return;
        handleClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const at = openModals.indexOf(token);
      if (at !== -1) openModals.splice(at, 1);
    };
  }, [shouldRender, handleClose]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`}
      role={role}
      aria-modal="true"
      aria-label={ariaLabel || title}
      {...swipeHandlers}
    >
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        ref={contentRef}
        className={`
          relative ${maxWidth} w-full
          bg-surface border border-border-default rounded-xl
          shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'}
          max-h-[90vh] overflow-y-auto
        `}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          {/* Only emit a heading when the dialog actually has a name — an empty
              <h2> is a phantom landmark in the accessibility tree. */}
          {title && (
            <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          )}
          <button
            onClick={handleClose}
            className="ml-auto p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
