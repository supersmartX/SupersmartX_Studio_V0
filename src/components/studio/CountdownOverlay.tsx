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
      oscillator.frequency.value = countdownText === 'Record' ? 880 : 660;
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

  // The recorder publishes the first beat immediately (3), then 2, 1 and a
  // final Record cue before capture begins. Cancelling stays available from
  // the first frame, in both this overlay and the transport.
  const show = isVisible && !!countdownText;
  const isRecordCue = countdownText === 'Record';

  return (
    <div
      // Keep the framing visible: this is the last check of hair/lighting
      // before the take starts. 55% is enough contrast for the numeral while
      // the camera stays readable instead of going near-black.
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-canvas/55 backdrop-blur-sm transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!show}
    >
      {/* A STABLE live region: the visible cue is replaced on every beat
          (for the animation), so putting aria-live on the replaced node can
          miss announcements. Screen readers hear useful words, not just the
          digit. */}
      <span aria-live="assertive" aria-atomic="true" className="sr-only">
        {show ? (isRecordCue ? 'Recording now' : `Starting in ${countdownText}`) : ''}
      </span>

      <span
        key={countdownText}
        data-testid="countdown-value"
        aria-hidden="true"
        className={
          isRecordCue
            ? 'text-5xl sm:text-6xl font-semibold tracking-[0.04em] text-white drop-shadow-[0_0_60px_rgba(124,58,237,0.45)] animate-countdown'
            : 'text-8xl sm:text-9xl font-semibold tabular-nums text-white drop-shadow-[0_0_60px_rgba(124,58,237,0.45)] animate-countdown'
        }
      >
        {countdownText}
      </span>

      {/* The countdown must be cancellable: cancelling leaves the recorder
          idle (no capture session, no quota/teleprompter consumed). */}
      {show && onCancel && (
        <button
          onClick={onCancel}
          aria-label="Cancel countdown"
          className="px-4 py-2 rounded-full bg-white/[0.08] ring-1 ring-white/10 text-white/80 text-[12px] font-medium hover:bg-white/[0.14] hover:text-white transition-colors min-h-[44px]"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
