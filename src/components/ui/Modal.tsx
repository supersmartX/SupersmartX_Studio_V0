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

export function Modal({ isOpen, onClose, children, title, maxWidth = 'max-w-lg', ariaLabel }: ModalProps) {
  const { isClosing, shouldRender, handleClose, swipeHandlers } = useModalAnimation(isOpen, onClose);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldRender || !contentRef.current) return;
    const focusable = contentRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
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
      role="dialog"
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
          <h2 className="text-sm font-semibold text-text-primary">{title || ''}</h2>
          <button
            onClick={handleClose}
            className="p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
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
