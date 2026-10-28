'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { validatePassword } from '@/lib/validation';
import { CloseIcon } from '@/components/icons';
import { StepItem } from './StepItem';
import { SocialButton } from './SocialButton';
import { InputGroup } from './InputGroup';
import { BrandLogo } from './BrandLogo';
import { GoogleIcon, EyeIcon } from './AuthIcons';
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
  mode = 'default',
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
  const [step, setStep] = useState<'chooser' | 'email'>(initialStep);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
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
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const { isClosing, shouldRender, handleClose: handleModalClose, swipeHandlers } = useModalAnimation(isOpen, handleClose);

  // The dialog panel itself — the boundary for the Tab trap below.
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes like every other modal. The auth step holds no destructive
  // state (credentials are never persisted until success), so dismissal is safe.
  // Tab is trapped so keyboard focus cannot fall out onto the page behind —
  // the dialog is modal in every other respect, so it must be modal to Tab too.
  useEffect(() => {
    if (!shouldRender) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleModalClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = panelRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shouldRender, handleModalClose]);

  // Focus the dialog's first task control on open (never the Close button —
  // that would focus "leave this dialog"), and hand focus back to the trigger
  // on close so keyboard users don't get dumped onto <body>.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!shouldRender) return;
    const container = panelRef.current;
    if (!container) return;
    // A field inside the dialog may already hold focus — the register
    // step's First Name input and the sign-in step's email input set
    // autoFocus deliberately (see InputGroup, UX-012). Moving focus again
    // here would override that choice and land on the Google button
    // instead, so only act when nothing inside has focus yet.
    const active = document.activeElement;
    if (container.contains(active)) return;
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
  }, [shouldRender]);

  // Return focus to the control that opened this dialog. Snapshotting
  // `document.activeElement` when the dialog opens does NOT work here: the
  // login/register inputs' `autoFocus` runs during React's commit phase, before
  // any effect, so the snapshot would capture the input itself — which is
  // destroyed on close, leaving keyboard focus stranded on <body>.
  //
  // Instead record the last interaction that landed while the dialog was still
  // closed; that is the real trigger, whether the browser focuses buttons on
  // click (Chrome) or not (Firefox/Safari). The listeners are attached on mount
  // because the trigger's pointerdown/focusin fires before `shouldRender` ever
  // flips true, so gating them on the open state would always miss it.
  const shouldRenderRef = useRef(shouldRender);
  shouldRenderRef.current = shouldRender;
  useEffect(() => {
    const remember = (target: EventTarget | null) => {
      // Only a pre-open interaction counts as the trigger; anything that lands
      // after the dialog is up (backdrop, focus trap) must not overwrite it.
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
  }, []);

  // Hand focus back once the dialog is gone, but only if it would otherwise be
  // lost (still on <body> or a detached node), so we never steal focus from a
  // dialog that opened on top of this one.
  useEffect(() => {
    if (shouldRender) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    const active = document.activeElement;
    const focusIsLost =
      active === null ||
      active === document.body ||
      active === document.documentElement ||
      !active.isConnected;
    if (target && target.isConnected && focusIsLost) {
      target.focus();
    }
  }, [shouldRender]);

  if (!shouldRender) return null;

  return (
    <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label={step === 'chooser' ? 'Create New Profile' : 'Enter your email'} {...swipeHandlers}>
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
                  {step === 'chooser' ? 'Create New Profile' : 'Enter your email'}
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
                <button
                  onClick={handleEmailSubmit}
                  disabled={isLoading}
                  className="w-full h-12 bg-accent text-white font-semibold rounded-lg hover:bg-accent-hover active:scale-[0.98] transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Creating Account...' : 'Create Account'}
                </button>

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
                {intent === 'login' && (
                  <>
                    {/* Social Buttons - available when user explicitly chose to log in */}
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
                  </>
                )}
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

                <button
                  onClick={handleEmailSubmit}
                  disabled={isLoading || !email || !loginPassword}
                  className="w-full h-12 bg-accent text-white font-semibold rounded-lg hover:bg-accent-hover active:scale-[0.98] transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Signing in...' : 'Log in'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
