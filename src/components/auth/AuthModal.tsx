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

function StepItem({ number, text, active = false }: { number: number; text: string; active?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${active ? 'bg-white text-black' : 'bg-[#1A1A1A] text-white'}`}>
      <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0 ${active ? 'bg-black text-white' : 'bg-white/10 text-white/40'}`}>
        {number}
      </span>
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}

function SocialButton({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2.5 py-3 bg-[#111113] border border-white/10 rounded-xl hover:bg-white/5 transition-all text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
      {label}
    </button>
  );
}

function InputGroup({ label, placeholder, type = 'text', value, onChange, rightElement, helperText }: {
  label: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  rightElement?: React.ReactNode;
  helperText?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-white">{label}</label>
      <div className="relative">
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#1A1A1A] border-none rounded-xl h-11 px-4 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
        />
        {rightElement && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {rightElement}
          </div>
        )}
      </div>
      {helperText && (
        <p className="text-[11px] text-white/30">{helperText}</p>
      )}
    </div>
  );
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const GithubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const EyeIcon = ({ visible }: { visible: boolean }) => (
  <span className="text-white/30 hover:text-white/60 transition-colors cursor-pointer">
    {visible ? (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    ) : (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )}
  </span>
);

const BrandLogo = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
  <div className="flex items-center gap-2">
    <div className={`${size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'} rounded-full bg-white flex items-center justify-center`}>
      <svg width={size === 'sm' ? 14 : 16} height={size === 'sm' ? 14 : 16} viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </div>
    <span className={`${size === 'sm' ? 'text-lg' : 'text-xl'} font-semibold tracking-tight text-white`}>SupersmartX</span>
  </div>
);

export function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  title = 'Create an account or sign in',
  callbackUrl = '/studio',
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 transition-all duration-500" role="dialog" aria-modal="true" aria-label="Sign in">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md animate-fade-in"
        onClick={handleClose}
      />

      <div className="relative flex w-full max-w-[960px] min-h-[600px] max-h-[90vh] bg-[#09090B] rounded-3xl shadow-2xl animate-scale-in overflow-hidden border border-white/[0.06]">
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
                    <span className="bg-[#09090B] px-4 text-xs font-medium text-white/40 uppercase tracking-widest">
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
                        className="w-full bg-[#1A1A1A] border-none rounded-xl h-11 px-4 pr-10 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
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
                    className="w-full bg-[#1A1A1A] border-none rounded-xl h-11 px-4 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
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
