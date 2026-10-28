'use client';

import { useEffect, useState } from 'react';

interface ToastProps {
  message: string | null;
  queueLength?: number;
}

export function Toast({ message, queueLength = 0 }: ToastProps) {
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
      // Clear of everything fixed below the viewport. The stack is now the
      // Footer (1.75rem, and only at md+) plus the transport bar (3.5–4rem) —
      // ≈ 5.75rem at its tallest; below md the footer is hidden and it is just
      // the transport. One offset clears both, so the toast never covers the
      // record controls (the old inline `bottom: 5rem` style pinned it over the
      // transport and defeated the responsive classes).
      //
      // `pointer-events-none` is deliberate and load-bearing: this is a
      // transient, purely informational notice with no controls of its own, and
      // the bottom stack varies with layout (the review state adds a preview
      // switcher and an Export row above the transport). No offset can clear
      // every state, so rather than let a 2.7s notice ever swallow a click on
      // the record or Export controls, it is transparent to the pointer
      // entirely — the message stays readable, input passes straight through.
      //
      // The `visible` binding is equally load-bearing: this notice has no close
      // control, so the fade-out below IS its only dismissal. `displayMessage`
      // outlives it by design (it keeps the text through the exit transition),
      // which means a hardcoded visible class left the last notice — e.g. the
      // "Shortcuts" help text — pinned over the transport for the whole session.
      className={`pointer-events-none fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 z-toast bg-surface border border-border-default px-3 py-2 rounded-lg shadow-xl flex items-center gap-2 text-xs font-medium text-text-primary transition-all duration-200 max-w-[calc(100vw-2rem)] ${
        visible ? 'animate-slide-up opacity-100' : 'opacity-0 translate-y-2'
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="text-accent">&#128279;</span>
      <span>{displayMessage}</span>
      {queueLength > 0 && (
        <span className="text-text-muted ml-1">(+{queueLength})</span>
      )}
    </div>
  );
}
