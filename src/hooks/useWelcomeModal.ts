'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'sxs-studio-hide-welcome';

export function useWelcomeModal() {
  const [isVisible, setIsVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    try {
      const hidden = localStorage.getItem(STORAGE_KEY);
      if (!hidden) {
        const timer = setTimeout(() => setIsVisible(true), 500);
        return () => clearTimeout(timer);
      }
    } catch {
      const timer = setTimeout(() => setIsVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const closeModal = () => {
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
