'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'sxs-studio-hide-welcome';

export function useWelcomeModal() {
  const [isVisible, setIsVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const hidden = localStorage.getItem(STORAGE_KEY);
    if (!hidden) {
      const timer = setTimeout(() => setIsVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const closeModal = () => {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, 'true');
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
