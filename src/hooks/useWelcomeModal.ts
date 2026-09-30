'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'sxs-studio-hide-welcome';
// Per-tab, and deliberately not localStorage: sessionStorage survives the
// cross-document navigation the payment redirect and Google OAuth perform in
// this same tab, so onboarding cannot reappear stacked on top of "You're a
// Creator" (and swallow its Continue click) on the way back. A new tab is a
// new visitor, which is exactly when onboarding belongs.
const SESSION_KEY = 'sxs-studio-welcome-seen';

export function useWelcomeModal() {
  const [isVisible, setIsVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(SESSION_KEY)) {
        return;
      }
    } catch {
      // Storage unavailable: show it rather than hide onboarding forever.
    }
    const timer = setTimeout(() => setIsVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const closeModal = () => {
    // A dismissal is a dismissal. Without this the modal came back on every
    // full page load, including the return from checkout.
    try {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } catch {
      // sessionStorage not available
    }
    if (dontShowAgain) {
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        // localStorage not available
      }
    }
    setIsVisible(false);
  };

  return {
    isVisible,
    dontShowAgain,
    setDontShowAgain,
    closeModal,
  };
}
