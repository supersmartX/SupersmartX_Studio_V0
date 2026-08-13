'use client';

import { useState, useCallback } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { CloseIcon } from '@/components/icons';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  subtitle?: string;
  callbackUrl?: string;
}

export function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  title = 'Create an account or sign in',
  subtitle,
  callbackUrl = '/studio',
}: AuthModalProps) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'chooser' | 'email'>('chooser');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { update } = useSession();

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      await signIn('google', { callbackUrl });
    } catch {
      setError('Google sign-in failed. Please try again or use email.');
      setIsLoading(false);
    }
  }, [callbackUrl]);

  const handleEmailSubmit = useCallback(async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const result = await signIn('credentials', {
        email,
        redirect: false,
      });

      if (result?.error) {
        setError('Sign-in failed. Please try again.');
        setIsLoading(false);
      } else {
        await update();
        onSuccess?.();
        onClose();
      }
    } catch {
      setError('Sign-in failed. Please try again.');
      setIsLoading(false);
    }
  }, [email, onSuccess, onClose, update]);

  const handleBack = useCallback(() => {
    setStep('chooser');
    setError('');
    setEmail('');
  }, []);

  const handleClose = useCallback(() => {
    setStep('chooser');
    setEmail('');
    setError('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Sign in">
      <div
        className="absolute inset-0 bg-canvas/80 backdrop-blur-md animate-fade-in"
        onClick={handleClose}
      />

      <div className="relative w-full max-w-sm bg-surface border border-border-default rounded-xl shadow-2xl animate-scale-in overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            {step === 'email' && (
              <button
                onClick={handleBack}
                className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors"
                aria-label="Back"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <h2 className="text-sm font-semibold text-text-primary">
              {step === 'chooser' ? 'SuperSmartX' : 'Enter your email'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {step === 'chooser' && (
            <>
              <div className="text-center">
                <h3 className="text-base font-bold text-text-primary mb-1">
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-[13px] text-text-secondary">{subtitle}</p>
                )}
              </div>

              {process.env.NEXT_PUBLIC_GOOGLE_AUTH === 'true' && (
                <>
                  <button
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-3 py-3 bg-white hover:bg-gray-50 text-gray-900 rounded-lg font-semibold text-sm transition-all border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    {isLoading ? 'Signing in...' : 'Continue with Google'}
                  </button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border-subtle" />
                    </div>
                    <div className="relative flex justify-center text-[11px]">
                      <span className="px-2 bg-surface text-text-muted">or</span>
                    </div>
                  </div>
                </>
              )}

              {process.env.NEXT_PUBLIC_GOOGLE_AUTH !== 'true' && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border-subtle" />
                  </div>
                  <div className="relative flex justify-center text-[11px]">
                    <span className="px-2 bg-surface text-text-muted">or</span>
                  </div>
                </div>
              )}

              <button
                onClick={() => setStep('email')}
                className="w-full py-3 bg-elevated hover:bg-subtle text-text-primary rounded-lg font-semibold text-sm transition-all border border-border-subtle"
              >
                Continue with Email
              </button>

              <p className="text-[10px] text-text-muted text-center leading-relaxed">
                By continuing, you agree to the{' '}
                <a href="/terms" className="underline">Terms</a>
                {' '}and{' '}
                <a href="/privacy" className="underline">Privacy Policy</a>.
              </p>
            </>
          )}

          {step === 'email' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Email address
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
                  autoFocus
                  className="w-full px-3 py-2.5 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
                />
              </div>

              {error && (
                <p className="text-xs text-recording text-center">{error}</p>
              )}

              <button
                onClick={handleEmailSubmit}
                disabled={isLoading || !email}
                className="w-full py-3 bg-accent hover:opacity-90 text-white rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Signing in...' : 'Continue'}
              </button>

              <p className="text-[10px] text-text-muted text-center leading-relaxed">
                By continuing, you agree to the{' '}
                <a href="/terms" className="underline">Terms</a>
                {' '}and{' '}
                <a href="/privacy" className="underline">Privacy Policy</a>.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
