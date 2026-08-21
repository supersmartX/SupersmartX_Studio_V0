'use client';

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

  if (!shouldRender) return null;

  return (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Welcome" {...swipeHandlers}>
      <div className={`absolute inset-0 bg-canvas/80 backdrop-blur-md ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`} />

      <div className={`relative w-full max-w-xl bg-surface border border-border-default rounded-xl shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden max-h-[90vh] overflow-y-auto`}>
        <button
          onClick={closeModal}
          className="absolute top-3 right-3 p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close"
        >
          <CloseIcon className="w-4 h-4" />
        </button>

        <div className="relative px-5 sm:px-8 pt-10 pb-6 text-center">
          <div className="absolute -top-16 -left-16 w-48 h-48 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

          <div className="w-16 h-16 mx-auto mb-5">
            <img
              src="/SXS_ICON.png"
              alt="SupersmartX Logo"
              className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(124,58,237,0.3)]"
            />
          </div>

          <h1 className="text-xl font-bold text-text-primary mb-2">
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
                desc: 'Everything stays on your device. No uploads. No accounts.',
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
                  <span className="text-[11px] font-semibold text-text-primary">
                    {feature.title}
                  </span>
                  <p className="text-[10px] text-text-muted leading-relaxed">
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
            className="w-full py-2.5 min-h-[44px] text-[13px] text-text-muted hover:text-text-secondary font-medium transition-colors"
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
              <span className="text-[11px] text-text-muted group-hover:text-text-secondary transition-colors">
                Don&apos;t show again
              </span>
            </label>
            <span className="text-[10px] text-text-muted italic">
              Permissions requested on first use.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
