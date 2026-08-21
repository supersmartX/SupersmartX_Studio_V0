'use client';

interface TimerProps {
  isRunning: boolean;
  elapsedSeconds: number;
}

export function Timer({ isRunning, elapsedSeconds }: TimerProps) {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div className="absolute top-3 right-3 z-20">
      <div
        className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-canvas/60 backdrop-blur-md border border-border-subtle"
        role="timer"
        aria-label={`Elapsed recording time: ${display}`}
        aria-live="off"
      >
        <span
          className={`text-xs font-mono tabular-nums ${
            isRunning ? 'text-text-primary' : 'text-text-muted'
          }`}
        >
          {display}
        </span>
      </div>
    </div>
  );
}
