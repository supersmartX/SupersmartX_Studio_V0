'use client';

interface TimerProps {
  isRunning: boolean;
  /** Paused still needs the frozen time visible — it is a distinct state. */
  isPaused?: boolean;
  elapsedSeconds: number;
}

/**
 * Canvas clock.
 *
 * One clock per layout: at ≥lg the transport shows elapsed time next to Stop,
 * so this overlay stays out of the camera entirely. Below lg the transport
 * clock is hidden (the bar cannot fit it next to the labelled chips) and the
 * canvas carries the time instead. Idle renders nothing — the transport's
 * "00:00 / Ready" is the quiet idle state, and a second idle clock on the
 * camera was pure duplication.
 */
export function Timer({ isRunning, isPaused = false, elapsedSeconds }: TimerProps) {
  if (!isRunning && !isPaused) return null;

  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20 lg:hidden">
      <div
        className={`flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/[0.08] ${
          isPaused ? 'text-warning' : 'text-white/85'
        }`}
        role="timer"
        aria-label={`Elapsed recording time: ${display}`}
        aria-live="off"
      >
        <span className="text-[11px] font-mono tabular-nums">{display}</span>
      </div>
    </div>
  );
}
