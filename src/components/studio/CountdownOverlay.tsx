'use client';

import { useEffect, useRef } from 'react';

interface CountdownOverlayProps {
  countdownText: string;
  isVisible: boolean;
  /** Cancels the pending countdown and leaves the recorder idle. */
  onCancel?: () => void;
}

export function CountdownOverlay({ countdownText, isVisible, onCancel }: CountdownOverlayProps) {
  const prevTextRef = useRef('');
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !countdownText || countdownText === prevTextRef.current) return;
    prevTextRef.current = countdownText;

    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.value = countdownText === '0' ? 880 : 660;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.15);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        ctx?.close();
        ctx = null;
      }, 200);
    } catch { /* AudioContext not available */ }
  }, [countdownText, isVisible]);

  useEffect(() => {
    if (!isVisible) prevTextRef.current = '';
  }, [isVisible]);

  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-canvas/80 backdrop-blur-sm transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!isVisible}
    >
      <span
        key={countdownText}
        aria-live="assertive"
        className="text-7xl font-bold text-accent drop-shadow-[0_0_40px_rgba(124,58,237,0.5)] animate-countdown"
      >
        {countdownText}
      </span>

      {/* The countdown must be cancellable: cancelling leaves the recorder
          idle (no capture session, no quota/teleprompter consumed). */}
      {isVisible && onCancel && (
        <button
          onClick={onCancel}
          aria-label="Cancel countdown"
          className="px-5 py-2.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/15 text-white/90 text-[13px] font-medium hover:bg-black/80 hover:text-white transition-colors min-h-[44px]"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
