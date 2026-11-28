'use client';

import { useEffect, useRef } from 'react';

interface UseDialogFocusOptions {
  /** The dialog's rendered state (from useModalAnimation). */
  shouldRender: boolean;
  /** Called when Escape is pressed. */
  onClose: () => void;
  /** The dialog panel — the boundary for the Tab trap. */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Extra dependencies for the initial-focus run: a dialog whose body swaps
   * (plan grid → processing panel, skeleton → real content) is a new task,
   * and focus may have been left on a control that no longer exists.
   */
  initialFocusDeps?: readonly unknown[];
  /**
   * Custom initial-focus behavior. When provided it replaces the default
   * rule (explicit [data-modal-initial-focus] marker, else the first
   * focusable that is not the header Close button).
   */
  focusOnOpen?: (() => void) | null;
  /**
   * When true, Escape/Tab are ignored entirely: a confirmation raised from
   * inside this sheet owns both keys while it is open, and one Escape must
   * not dismiss the sheet behind it.
   */
  suspended?: boolean;
  /**
   * How the opening trigger is captured for focus return.
   * - 'activeElement' (default): snapshot document.activeElement when the
   *   dialog opens. Works when the dialog focuses nothing on open, or a
   *   focus target inside it runs in an effect after the snapshot.
   * - 'interaction': record the last pointerdown/focusin that landed while
   *   the dialog was closed. Required when an input's autoFocus commits
   *   before any effect — the snapshot would capture the input itself,
   *   which is destroyed on close, stranding focus on <body>.
   * - 'none': no capture or restore. For dialogs whose return-focus rule
   *   is genuinely custom (e.g. a preferred in-page destination chosen at
   *   close time) and own the whole capture/restore cycle themselves.
   */
  triggerCapture?: 'activeElement' | 'interaction' | 'none';
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function collectFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
  );
}

function isFocusLost(active: Element | null): boolean {
  return (
    active === null ||
    active === document.body ||
    active === document.documentElement ||
    !(active instanceof HTMLElement) ||
    !active.isConnected
  );
}

/**
 * Shared dialog keyboard/focus contract: Tab trapped inside the panel,
 * Escape dismisses, focus lands on the dialog's task (never the header
 * Close) when it opens, and focus returns to the trigger when it closes —
 * only if it would otherwise be lost, so a dialog stacked on top keeps its
 * own focus.
 *
 * Extracted from the four full-screen dialogs (AuthModal, PricingModal,
 * WelcomeModal, ExportModal) that previously carried near-identical copies
 * of this block and had already drifted (e.g. the Google button visible on
 * one login path but not another).
 */
export function useDialogFocus({
  shouldRender,
  onClose,
  containerRef,
  initialFocusDeps = [],
  focusOnOpen = null,
  suspended = false,
  triggerCapture = 'activeElement',
}: UseDialogFocusOptions): void {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const shouldRenderRef = useRef(shouldRender);
  shouldRenderRef.current = shouldRender;
  // Kept in a ref so an inline callback at the call site cannot re-trigger
  // the initial-focus effect on every render.
  const focusOnOpenRef = useRef(focusOnOpen);
  focusOnOpenRef.current = focusOnOpen;

  // Capture the trigger. 'interaction' listeners sit at document level from
  // mount because the trigger's pointerdown/focusin fires before
  // `shouldRender` flips true.
  useEffect(() => {
    if (triggerCapture !== 'interaction') return;    const remember = (target: EventTarget | null) => {
      if (shouldRenderRef.current) return;
      if (!(target instanceof HTMLElement)) return;
      if (target === document.body || target === document.documentElement) return;
      returnFocusRef.current = target;
    };
    const onFocusIn = (e: FocusEvent) => remember(e.target);
    const onPointerDown = (e: PointerEvent) => remember(e.target);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [triggerCapture]);

  // 'activeElement' capture + restore.
  useEffect(() => {
    if (triggerCapture !== 'activeElement') return;
    if (shouldRender) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      return;
    }
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    const active = document.activeElement;
    if (target && target.isConnected && isFocusLost(active)) {
      target.focus();
    }
  }, [shouldRender, triggerCapture]);

  // Escape + Tab trap.
  useEffect(() => {
    if (!shouldRender) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (suspendedRef.current) return;
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const focusable = collectFocusable(root);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !root.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (triggerCapture === 'interaction') {
        // 'interaction' dialogs restore here, where the dialog is fully gone.
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        const active = document.activeElement;
        if (target && target.isConnected && isFocusLost(active)) {
          target.focus();
        }
      }
    };
  }, [shouldRender, triggerCapture, containerRef]);

  // Initial focus.
  useEffect(() => {
    if (!shouldRender) return;
    const root = containerRef.current;
    if (!root) return;
    if (focusOnOpenRef.current) {
      focusOnOpenRef.current();
      return;
    }
    const explicit = root.querySelector<HTMLElement>('[data-modal-initial-focus]');
    // A disabled marker cannot take focus and must not end the search.
    if (explicit && !explicit.hasAttribute('disabled')) {
      explicit.focus();
      return;
    }
    const focusable = collectFocusable(root);
    if (focusable.length === 0) return;
    const firstTaskControl =
      focusable.find((el) => el.getAttribute('aria-label') !== 'Close') ?? focusable[0];
    firstTaskControl.focus();
  }, [shouldRender, containerRef, ...initialFocusDeps]);
}
