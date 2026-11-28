'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { validatePassword } from '@/lib/validation';
import { BrandLogo } from '@/components/auth/BrandLogo';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);

  useEffect(() => {
    if (!token) setInvalidToken(true);
  }, [token]);

  const handleSubmit = useCallback(async () => {
    // Same policy as registration (validatePassword): the two password
    // surfaces previously disagreed (register demanded complexity, reset
    // only 8 characters), so a password accepted at reset could fail at
    // the next sign-in — or vice versa.
    const validation = validatePassword(password);
    if (!validation.valid) {
      setError(validation.errors[0]);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!token) {
      setError('Invalid reset token');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setSuccess(true);
      } else {
        const data = await res.json();
        setError(data.error || 'Reset failed. The link may have expired.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [password, confirmPassword, token]);

  // The landing page consumes this flag once and opens the login step of the
  // auth dialog — the labelled "Log in" button previously just went home and
  // made the user find login themselves.
  const goLogIn = useCallback(() => {
    try { sessionStorage.setItem('sxs-open-login', '1'); } catch {}
  }, []);

  const inputClass =
    'w-full bg-elevated border border-border-subtle rounded-lg h-11 px-4 pr-10 text-text-primary text-sm placeholder:text-text-muted focus:border-accent outline-none transition-all';

  const eyeButton = (visible: boolean, toggle: () => void, label: string) => (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {visible ? (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        ) : (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        )}
      </svg>
    </button>
  );

  if (invalidToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1 className="text-xl font-medium text-text-primary">Invalid reset link</h1>
          <p className="text-sm text-text-secondary">This password reset link is invalid or has expired.</p>
          <Link href="/" className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-xl font-medium text-text-primary">Password reset!</h1>
          <p className="text-sm text-text-secondary">Your password has been updated. You can now log in.</p>
          <Link href="/" onClick={goLogIn} className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all">
            Log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="flex justify-center">
          <BrandLogo size="sm" />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-medium text-text-primary">Set new password</h1>
          <p className="text-sm text-text-secondary">Enter your new password below.</p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-password" className="text-sm font-medium text-text-primary">New Password</label>
            <div className="relative">
              <input
                id="reset-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              {eyeButton(showPassword, () => setShowPassword(!showPassword), showPassword ? 'Hide password' : 'Show password')}
            </div>
            <p className="text-[12px] text-text-secondary">8+ characters with uppercase, lowercase, number, and special character.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-password-confirm" className="text-sm font-medium text-text-primary">Confirm Password</label>
            <div className="relative">
              <input
                id="reset-password-confirm"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                className={inputClass}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-error text-center">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLoading || !password || !confirmPassword}
            className="w-full h-12 bg-accent text-white font-semibold rounded-lg hover:bg-accent-hover active:scale-[0.98] transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>

        <p className="text-sm text-text-secondary text-center">
          <Link href="/" onClick={goLogIn} className="relative text-text-primary font-medium hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <span className="text-sm text-text-secondary">Loading...</span>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
