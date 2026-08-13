'use client';

import { useEffect, useState } from 'react';

interface ToastProps {
  message: string | null;
}

export function Toast({ message }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const [displayMessage, setDisplayMessage] = useState('');

  useEffect(() => {
    if (message) {
      setDisplayMessage(message);
      setVisible(true);

      const timer = setTimeout(() => {
        setVisible(false);
      }, 2700);

      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message]);

  if (!displayMessage) return null;

  return (
    <div
      className={`fixed bottom-20 sm:bottom-16 left-1/2 -translate-x-1/2 z-[300] bg-surface border border-border-default px-3 py-2 rounded-lg shadow-xl flex items-center gap-2 text-xs font-medium text-text-primary transition-all duration-200 max-w-[calc(100vw-2rem)] ${
        visible
          ? 'animate-slide-up opacity-100'
          : 'opacity-0 translate-y-2 pointer-events-none'
      }`}
      role="status"
      aria-live="polite"
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <span className="text-accent">&#128279;</span>
      <span>{displayMessage}</span>
    </div>
  );
}
