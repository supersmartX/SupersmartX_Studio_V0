'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { CloseIcon } from '@/components/icons';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface WelcomeModalProps {
  isVisible: boolean;
  dontShowAgain: boolean;
  onDontShowChange: (checked: boolean) => void;
  onGetStarted: () => void;
  onExploreStudio: () => void;
}

export function WelcomeModal({
  isVisible,
  dontShowAgain,
  onDontShowChange,
  onGetStarted,
  onExploreStudio,
}: WelcomeModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isVisible, onExploreStudio);

  // The dialog panel — the boundary for the Tab trap below.
  const panelRef = useRef<HTMLDivElement>(null);
  // The control that opened this dialog, so closing hands focus back to it.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Escape dismisses, Tab is trapped inside the sheet, and the primary action
  // takes focus on open. This dialog is modal in every other respect, so
  // keyboard focus must not be able to fall out onto the page behind it.
  useEffect(() => {
    if (!shouldRender) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;

    // Land on the primary task ("Get Started"), not on "leave this dialog" —
    // but only when that control is already inside the visible body. On a
    // short viewport the CTA sits below the fold, and focusing it scrolled the
    // body ~350px so the dialog opened mid-content with its title off-screen.
    // In that case focus lands on the dialog's own heading: it is visible at
    // the top, it names the dialog, and the first Tab still reaches the CTA.
    const container = panelRef.current;
    if (container) {
      const scroller = container.querySelector<HTMLElement>('[data-welcome-scroll]');
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      const firstTaskControl =
        focusable.find((el) => el.getAttribute('aria-label') !== 'Close') ?? focusable[0];
      const box = scroller?.getBoundingClientRect();
      const taskRect = firstTaskControl?.getBoundingClientRect();
      const taskVisible =
        !!box && !!taskRect && taskRect.top >= box.top && taskRect.bottom <= box.bottom;
      const heading = container.querySelector<HTMLElement>('[data-welcome-heading]');
      (taskVisible ? firstTaskControl : heading ?? focusable[0])?.focus({ preventScroll: true });
      if (scroller) scroller.scrollTop = 0;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
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
      // Hand focus back to the trigger once the sheet is gone.
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      const nowActive = document.activeElement;
      const focusIsLost =
        nowActive === null ||
        nowActive === document.body ||
        nowActive === document.documentElement ||
        !nowActive.isConnected;
      if (target && target.isConnected && focusIsLost) {
        target.focus();
      }
    };
  }, [shouldRender, closeModal]);

  if (!shouldRender) return null;

  return (
    <div className={`fixed inset-0 z-onboard isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Welcome" {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={closeModal}
      />

      {/* The panel is capped to the viewport and its BODY scrolls, so the Close
          control stays pinned at the panel's top edge on short screens. Without
          the cap the panel grew past a 375×812 / 390×844 viewport and the Close
          button landed at a negative Y — unreachable. */}
      <div ref={panelRef} className={`relative w-full max-w-xl bg-surface border border-border-default rounded-xl shadow-2xl max-h-[calc(100dvh-2rem)] flex flex-col ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden`}>
        <button
          onClick={closeModal}
          className="absolute top-3 right-3 p-2.5 rounded-md bg-surface/80 backdrop-blur-sm text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close"
        >
          <CloseIcon className="w-4 h-4" />
        </button>

        <div data-welcome-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative px-5 sm:px-8 pt-10 pb-6 text-center">
          <div className="absolute -top-16 -left-16 w-48 h-48 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

          <div className="w-16 h-16 mx-auto mb-5">
            <img
              src="/brand/studio/logo/primary/studio-mark-approved-1024.png"
              alt="SupersmartX Logo"
              className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(124,58,237,0.3)]"
            />
          </div>

          {/* Focus lands here when the CTA is below the fold (short viewport).
              It is a reading target, not a control, so it takes no focus ring
              (see globals.css) — the controls below keep theirs. */}
          <h1 data-welcome-heading tabIndex={-1} className="text-xl font-bold text-text-primary mb-2">
            Welcome to{' '}
            <span className="text-accent">SUPERSMARTX</span>{' '}
            Studio
          </h1>
          <p className="text-[13px] text-text-secondary max-w-sm mx-auto leading-relaxed">
            Read naturally, maintain better eye contact, and record professional
            videos from your browser.
          </p>
        </div>

        <div className="px-5 sm:px-8 pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                icon: (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                ),
                title: 'Natural Eye Line',
                desc: 'Keep your script close to the camera for natural eye contact.',
              },
              {
                icon: (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ),
                title: 'Private by Design',
                desc: 'Your recording stays on your device until you choose to export. Creator exports are then uploaded to your own private cloud library.',
              },
              {
                icon: (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                ),
                title: 'One-Click Record',
                desc: 'Start recording instantly and export when done.',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="p-3 bg-elevated border border-border-subtle rounded-lg flex flex-col gap-2"
              >
                <div className="w-8 h-8 rounded-md bg-accent/10 text-accent flex items-center justify-center">
                  {feature.icon}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-semibold text-text-primary">
                    {feature.title}
                  </span>
                  <p className="text-[12px] text-text-secondary leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 sm:px-8 pb-8 flex flex-col gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={() => { closeModal(); setTimeout(onGetStarted, 150); }}
            className="w-full"
          >
            Get Started
          </Button>
          <button
            onClick={closeModal}
            className="w-full py-2.5 min-h-[44px] text-[13px] text-text-secondary hover:text-text-primary font-medium transition-colors active:scale-[0.98]"
          >
            Explore Studio
          </button>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-4 border-t border-border-subtle">
            <label className="flex items-center gap-2 cursor-pointer group min-h-[44px] px-2">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => onDontShowChange(e.target.checked)}
                className="w-4 h-4 rounded border-border-default bg-elevated text-accent focus:ring-accent focus:ring-offset-surface"
              />
              <span className="text-[12px] text-text-secondary group-hover:text-text-primary transition-colors">
                Don&apos;t show again
              </span>
            </label>
            <span className="text-[12px] text-text-secondary italic">
              Permissions requested on first use.
            </span>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
