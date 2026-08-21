'use client';

import { useState, useCallback } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { CloseIcon } from '@/components/icons';
import { StepItem } from './StepItem';
import { SocialButton } from './SocialButton';
import { InputGroup } from './InputGroup';
import { BrandLogo } from './BrandLogo';
import { GoogleIcon, GithubIcon, EyeIcon } from './AuthIcons';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  subtitle?: string;
  callbackUrl?: string;
  mode?: 'default' | 'download';
}

export function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  title = 'Create an account or sign in',
  callbackUrl = '/studio',
  mode = 'default',
}: AuthModalProps) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      setError('Google sign-in failed. Please try again.');
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
    setFirstName('');
    setLastName('');
  }, []);

  const handleClose = useCallback(() => {
    setStep('chooser');
    setEmail('');
    setFirstName('');
    setLastName('');
    setError('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-2 transition-all duration-[var(--duration-slowest)]" role="dialog" aria-modal="true" aria-label="Sign in">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md animate-fade-in"
        onClick={handleClose}
      />

      <div className="relative flex w-full max-w-[960px] min-h-[600px] max-h-[90vh] bg-canvas rounded-3xl shadow-2xl animate-scale-in overflow-hidden border border-white/[0.06]">
        {/* Left Column - Hero (hidden on mobile) */}
        <div className="relative hidden lg:flex flex-col items-center justify-end w-[52%] pb-16 px-12 rounded-l-3xl overflow-hidden">
          <video
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          >
            <source
              src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260506_081238_406ed0e3-5d83-436e-a512-0bbff7ec5b95.mp4"
              type="video/mp4"
            />
          </video>

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/30" />

          <div className="relative z-10 w-full max-w-xs space-y-8 animate-fade-in">
            <BrandLogo />

            <div className="space-y-3">
              <h1 className="text-4xl font-medium tracking-tight text-white whitespace-nowrap">
                Start Creating
              </h1>
              <p className="text-white/60 text-sm leading-relaxed px-1">
                Follow these 3 quick steps to activate your studio and start recording.
              </p>
            </div>

            <div className="space-y-2">
              <StepItem number={1} text="Register your identity" active />
              <StepItem number={2} text="Configure your studio" />
              <StepItem number={3} text="Finalize your profile" />
            </div>
          </div>
        </div>

        {/* Right Column - Form */}
        <div className="flex-1 flex flex-col items-center justify-center py-10 lg:py-6 px-6 sm:px-12 lg:px-16 xl:px-20 overflow-y-auto lg:overflow-hidden">
          <div className="w-full max-w-xl space-y-7 lg:space-y-5 sm:space-y-8 animate-fade-in">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 lg:hidden">
                <BrandLogo size="sm" />
              </div>
              <div>
                <h2 className="text-3xl font-medium tracking-tight text-white">
                  {step === 'chooser' ? 'Create New Profile' : 'Enter your email'}
                </h2>
                {step === 'chooser' && (
                  <p className="text-white/40 text-sm mt-1">
                    {title}
                  </p>
                )}
              </div>
            </div>

            {step === 'chooser' && (
              <>
                {/* Social Buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <SocialButton
                    label="Google"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    icon={<GoogleIcon />}
                  />
                  <SocialButton
                    label="GitHub"
                    onClick={() => signIn('github', { callbackUrl })}
                    disabled={isLoading}
                    icon={<GithubIcon />}
                  />
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-canvas px-4 text-xs font-medium text-white/40 uppercase tracking-widest">
                      Or
                    </span>
                  </div>
                </div>

                {/* Form */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <InputGroup
                      label="First Name"
                      placeholder="John"
                      value={firstName}
                      onChange={setFirstName}
                    />
                    <InputGroup
                      label="Last Name"
                      placeholder="Doe"
                      value={lastName}
                      onChange={setLastName}
                    />
                  </div>
                  <InputGroup
                    label="Email"
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                    onChange={setEmail}
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter password"
                        className="w-full bg-input border-none rounded-xl h-11 px-4 pr-10 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                      >
                        <EyeIcon visible={showPassword} />
                      </button>
                    </div>
                    <p className="text-[11px] text-white/30">Requires at least 8 symbols.</p>
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-red-400 text-center">{error}</p>
                )}

                {/* Submit */}
                <button
                  onClick={handleEmailSubmit}
                  disabled={isLoading}
                  className="w-full h-14 bg-white text-black font-semibold rounded-xl hover:bg-white/90 active:scale-[0.98] transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Creating Account...' : 'Create Account'}
                </button>

                {/* Footer */}
                <p className="text-sm text-white/40 text-center">
                  Already have an account?{' '}
                  <button
                    onClick={() => setStep('email')}
                    className="text-white font-medium hover:underline"
                  >
                    Log in
                  </button>
                </p>
              </>
            )}

            {step === 'email' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white">Email address</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
                    autoFocus
                    className="w-full bg-input border-none rounded-xl h-11 px-4 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-400 text-center">{error}</p>
                )}

                <button
                  onClick={handleEmailSubmit}
                  disabled={isLoading || !email}
                  className="w-full h-14 bg-white text-black font-semibold rounded-xl hover:bg-white/90 active:scale-[0.98] transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Signing in...' : 'Continue'}
                </button>

                <p className="text-sm text-white/40 text-center">
                  <button onClick={handleBack} className="text-white font-medium hover:underline">
                    Back to all options
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
