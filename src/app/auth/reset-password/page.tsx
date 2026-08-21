'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

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
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters');
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

  if (invalidToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1 className="text-xl font-medium text-white">Invalid reset link</h1>
          <p className="text-sm text-white/40">This password reset link is invalid or has expired.</p>
          <Link href="/" className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 transition-all">
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
          <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-xl font-medium text-white">Password reset!</h1>
          <p className="text-sm text-white/40">Your password has been updated. You can now sign in.</p>
          <Link href="/" className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 transition-all">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-medium text-white">Set new password</h1>
          <p className="text-sm text-white/40">Enter your new password below.</p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-white">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-input border-none rounded-xl h-11 px-4 pr-10 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            <p className="text-[11px] text-white/30">Requires at least 8 characters.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-white">Confirm Password</label>
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className="w-full bg-input border-none rounded-xl h-11 px-4 text-white text-sm placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none transition-all"
            />
          </div>

          {error && (
            <p className="text-xs text-recording text-center">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLoading || !password || !confirmPassword}
            className="w-full h-14 bg-white text-black font-semibold rounded-xl hover:bg-white/90 active:scale-[0.98] transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>

        <p className="text-sm text-white/40 text-center">
          <Link href="/" className="text-white font-medium hover:underline">
            Back to sign in
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
        <span className="text-sm text-white/40">Loading...</span>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
