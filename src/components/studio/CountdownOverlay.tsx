'use client';

import { useEffect, useRef } from 'react';

interface CountdownOverlayProps {
  countdownText: string;
  isVisible: boolean;
}

export function CountdownOverlay({ countdownText, isVisible }: CountdownOverlayProps) {
  const prevTextRef = useRef('');

  useEffect(() => {
    if (!isVisible || !countdownText || countdownText === prevTextRef.current) return;
    prevTextRef.current = countdownText;

    try {
      const ctx = new AudioContext();
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
      setTimeout(() => ctx.close(), 200);
    } catch { /* AudioContext not available */ }
  }, [countdownText, isVisible]);

  useEffect(() => {
    if (!isVisible) prevTextRef.current = '';
  }, [isVisible]);

  return (
    <div
      className={`absolute inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-sm transition-opacity duration-200 ${
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
    </div>
  );
}
