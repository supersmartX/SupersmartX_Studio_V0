'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { validatePassword } from '@/lib/validation';
import { CloseIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { StepItem } from './StepItem';
import { SocialButton } from './SocialButton';
import { InputGroup } from './InputGroup';
import { BrandLogo } from './BrandLogo';
import { GoogleIcon, EyeIcon } from './AuthIcons';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  subtitle?: string;
  callbackUrl?: string;
  mode?: 'default' | 'download';
  /**
   * UX-005: which screen the dialog opens on. 'login' jumps straight to the
   * sign-in step (header "Log in"); 'register' (default) opens the account
   * chooser, preserving every existing purchase/guard flow.
   */
  intent?: 'register' | 'login';
}

export function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  title = 'Create an account or log in',
  callbackUrl = '/studio',
  intent = 'register',
}: AuthModalProps) {
  const initialStep: 'chooser' | 'email' = intent === 'login' ? 'email' : 'chooser';
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [step, setStep] = useState<'chooser' | 'email' | 'forgot'>(initialStep);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const { update } = useSession();

  // The modal body persists across opens (it only unmounts its output), so the
  // step must be re-seated to the CURRENT intent on every open — resetForm runs
  // at close time under the previous intent and can't know what opens next.
  useEffect(() => {
    if (isOpen) setStep(initialStep);
  }, [isOpen, initialStep, intent]);

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      await signIn('google', { callbackUrl, redirect: true });
    } catch {
      setError('Google login is not available. Please use email sign-in.');
      setIsLoading(false);
    }
  }, [callbackUrl]);

  // Password recovery. The endpoint is enumeration-safe: it answers {ok:true}
  // whether or not the address belongs to an account, so the UI must promise
  // nothing beyond "a link was sent if the account exists".
  const handleForgotSubmit = useCallback(async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok && res.status !== 429) throw new Error('failed');
      if (res.status === 429) {
        setError('Too many requests. Please wait a minute and try again.');
        setIsLoading(false);
        return;
      }
      setForgotSent(true);
      setIsLoading(false);
    } catch {
      setError('Something went wrong. Please try again.');
      setIsLoading(false);
    }
  }, [email]);

  const handleEmailSubmit = useCallback(async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    const isRegister = step === 'chooser';
    const name = isRegister ? [firstName, lastName].filter(Boolean).join(' ') : undefined;
    const passwordValue = isRegister ? password : loginPassword;

    if (isRegister) {
      if (!passwordValue) {
        setError('Please enter a password');
        return;
      }
      const validation = validatePassword(passwordValue);
      if (!validation.valid) {
        setError(validation.errors[0]);
        return;
      }
    } else if (!passwordValue) {
      setError('Please enter your password');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const payload: Record<string, string | boolean> = { email, redirect: false };
      if (passwordValue) payload.password = passwordValue;
      if (isRegister) {
        payload.mode = 'register';
        if (name) payload.name = name;
      }

      const result = await signIn('credentials', payload) as unknown as { error?: string | null } | void;

      if (result && 'error' in result && result.error) {
        setError(isRegister ? 'Registration failed. Please check your details and try again.' : 'Invalid email or password.');
        setIsLoading(false);
      } else {
        await update();
        onSuccess?.();
        onClose();
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setIsLoading(false);
    }
  }, [email, step, firstName, lastName, password, loginPassword, onSuccess, onClose, update]);

  const resetForm = useCallback(() => {
    setStep('chooser');
    setEmail('');
    setFirstName('');
    setLastName('');
    setPassword('');
    setLoginPassword('');
    setError('');
    setForgotSent(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const { isClosing, shouldRender, handleClose: handleModalClose, swipeHandlers } = useModalAnimation(isOpen, handleClose);

  // The dialog panel itself — the boundary for the Tab trap below.
  const panelRef = useRef<HTMLDivElement>(null);

  // Shared dialog contract: Escape closes (auth holds no destructive state —
  // credentials are never persisted until success), Tab is trapped so focus
  // cannot fall out onto the page behind, and focus returns to the trigger on
  // close. Trigger capture uses 'interaction' because snapshotting
  // `document.activeElement` on open does NOT work here: the login/register
  // inputs' `autoFocus` runs during React's commit phase, before any effect,
  // so the snapshot would capture the input itself — which is destroyed on
  // close, leaving keyboard focus stranded on <body>. Instead the hook records
  // the last interaction that landed while the dialog was still closed; that
  // is the real trigger, whether the browser focuses buttons on click (Chrome)
  // or not (Firefox/Safari).
  useDialogFocus({
    shouldRender,
    onClose: handleModalClose,
    containerRef: panelRef,
    triggerCapture: 'interaction',
    focusOnOpen: () => {
      const container = panelRef.current;
      if (!container) return;
      // A field inside the dialog may already hold focus — the register
      // step's First Name input and the sign-in step's email input set
      // autoFocus deliberately (see InputGroup, UX-012). Moving focus again
      // here would override that choice and land on the Google button
      // instead, so only act when nothing inside has focus yet.
      if (container.contains(document.activeElement)) return;
      const explicit = container.querySelector<HTMLElement>('[data-modal-initial-focus]');
      if (explicit && !explicit.hasAttribute('disabled')) {
        explicit.focus();
        return;
      }
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      const firstTaskControl =
        focusable.find((el) => el.getAttribute('aria-label') !== 'Close') ?? focusable[0];
      firstTaskControl?.focus();
    },
  });

if (!shouldRender) return null;

  return (
    <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label={step === 'chooser' ? 'Create New Profile' : step === 'forgot' ? 'Reset your password' : 'Enter your email'} {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={handleModalClose}
      />

      <div ref={panelRef} className={`relative flex w-full max-w-[960px] max-h-[90vh] bg-canvas rounded-2xl shadow-2xl overflow-hidden border border-border-subtle ${isClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
        {/* Close button */}
        <button
          onClick={handleModalClose}
          className="absolute top-4 right-4 z-10 p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
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
              <h1 className="text-4xl font-medium tracking-tight text-text-primary whitespace-nowrap">
                Start Creating
              </h1>
              <p className="text-text-secondary text-sm leading-relaxed px-1">
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
        {/* No `lg:overflow-hidden`: the password requirements line plus two
            name fields can exceed the dialog height at exactly the `lg` widths
            where the left hero appears, and clipping there trapped content
            with no way to reach it. The column scrolls instead. */}
        <div className="flex-1 flex flex-col items-center justify-center py-10 lg:py-6 px-6 sm:px-12 lg:px-16 xl:px-20 overflow-y-auto">
          <div className="w-full max-w-xl space-y-7 lg:space-y-5 sm:space-y-8 animate-fade-in">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 lg:hidden">
                <BrandLogo size="sm" />
              </div>
                <div>
                <h2 className="text-3xl font-medium tracking-tight text-text-primary">
                  {step === 'chooser' ? 'Create New Profile' : step === 'forgot' ? 'Reset your password' : 'Enter your email'}
                </h2>
                {step === 'chooser' && (
                  <p className="text-text-secondary text-sm mt-1">
                    {title}
                  </p>
                )}
                {step === 'email' && (
                  <p className="text-text-secondary text-sm mt-1">
                    We&apos;ll log you in with your email.
                  </p>
                )}
                {step === 'forgot' && (
                  <p className="text-text-secondary text-sm mt-1">
                    Enter your email and we&apos;ll send you a reset link.
                  </p>
                )}
              </div>
            </div>

            {step === 'chooser' && (
              <>
                {/* Social Buttons */}
                <div className="grid grid-cols-1 gap-3">
                  <SocialButton
                    label="Google"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    icon={<GoogleIcon />}
                  />
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-canvas px-4 text-xs font-medium text-text-secondary uppercase tracking-widest">
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
                      autoFocus
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
                    <label htmlFor="auth-register-password" className="text-sm font-medium text-text-primary">Password</label>
                    <div className="relative">
                      <input
                        id="auth-register-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-elevated border border-border-subtle rounded-lg h-11 px-4 pr-10 text-text-primary text-sm placeholder:text-text-muted focus:border-accent outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
                      >
                        <EyeIcon visible={showPassword} />
                      </button>
                    </div>
                    <p className="text-[12px] text-text-secondary">8+ characters with uppercase, lowercase, number, and special character.</p>
                  </div>
                </div>

                {error && (
                    <p className="text-xs text-recording text-center">{error}</p>
                )}

                {/* Submit */}
                <Button
                  onClick={handleEmailSubmit}
                  disabled={isLoading}
                  size="lg"
                  className="w-full"
                >
                  {isLoading ? 'Creating Account...' : 'Create Account'}
                </Button>

                {/* Footer */}
                <p className="text-sm text-text-secondary text-center">
                  Already have an account?{' '}
                  <button
                    onClick={() => setStep('email')}
                    className="relative text-white font-medium hover:underline after:absolute after:-inset-x-3 after:-inset-y-3 after:content-['']"
                  >
                    Log in
                  </button>
                </p>
              </>
            )}

            {step === 'email' && (
              <>
                {/* Social Buttons — shown on every path into this step. The
                    register→login handoff previously lost the Google option
                    the chooser had just shown (the block was gated on
                    intent === 'login'), so a user could arrive here with a
                    narrower set of providers than a moment earlier. */}
                <div className="grid grid-cols-1 gap-3">
                  <SocialButton
                    label="Google"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    icon={<GoogleIcon />}
                  />
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-canvas px-4 text-xs font-medium text-text-secondary uppercase tracking-widest">
                      Or
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="auth-login-email" className="text-sm font-medium text-text-primary">Email address</label>
                  <input
                    id="auth-login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
                    autoFocus
                    className="w-full bg-elevated border border-border-subtle rounded-lg h-11 px-4 text-text-primary text-sm placeholder:text-text-muted focus:border-accent outline-none transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="auth-login-password" className="text-sm font-medium text-text-primary">Password</label>
                  <div className="relative">
                    <input
                      id="auth-login-password"
                      type={showLoginPassword ? 'text' : 'password'}
                      placeholder="Enter password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
                      className="w-full bg-elevated border border-border-subtle rounded-lg h-11 px-4 pr-10 text-text-primary text-sm placeholder:text-text-muted focus:border-accent outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
                    >
                      <EyeIcon visible={showLoginPassword} />
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-recording text-center">{error}</p>
                )}

                <Button
                  onClick={handleEmailSubmit}
                  disabled={isLoading || !email || !loginPassword}
                  size="lg"
                  className="w-full"
                >
                  {isLoading ? 'Signing in...' : 'Log in'}
                </Button>

                <p className="text-sm text-text-secondary text-center">
                  <button
                    type="button"
                    onClick={() => { setError(''); setForgotSent(false); setStep('forgot'); }}
                    className="relative text-text-secondary font-medium hover:text-text-primary hover:underline after:absolute after:-inset-x-3 after:-inset-y-2 after:content-['']"
                  >
                    Forgot password?
                  </button>
                </p>
              </>
            )}

            {step === 'forgot' && (
              <>
                {forgotSent ? (
                  <div className="space-y-5" role="status">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-muted">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-10 6L2 7" />
                      </svg>
                    </div>
                    <p className="text-sm text-text-secondary text-center leading-relaxed">
                      If that email belongs to an account, a reset link is on
                      its way. It expires in one hour — check your spam folder
                      if it doesn&apos;t arrive.
                    </p>
                    <Button
                      type="button"
                      onClick={() => { setForgotSent(false); setStep('email'); }}
                      size="lg"
                      className="w-full"
                    >
                      Back to log in
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="auth-forgot-email" className="text-sm font-medium text-text-primary">Email address</label>
                      <input
                        id="auth-forgot-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleForgotSubmit()}
                        autoFocus
                        className="w-full bg-elevated border border-border-subtle rounded-lg h-11 px-4 text-text-primary text-sm placeholder:text-text-muted focus:border-accent outline-none transition-all"
                      />
                    </div>

                    {error && (
                      <p className="text-xs text-recording text-center">{error}</p>
                    )}

                    <Button
                      onClick={handleForgotSubmit}
                      disabled={isLoading || !email}
                      size="lg"
                      className="w-full"
                    >
                      {isLoading ? 'Sending...' : 'Send reset link'}
                    </Button>

                    <p className="text-sm text-text-secondary text-center">
                      <button
                        type="button"
                        onClick={() => { setError(''); setStep('email'); }}
                        className="relative text-text-secondary font-medium hover:text-text-primary hover:underline after:absolute after:-inset-x-3 after:-inset-y-2 after:content-['']"
                      >
                        Back to log in
                      </button>
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
