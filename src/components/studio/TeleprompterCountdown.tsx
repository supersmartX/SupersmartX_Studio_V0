'use client';

import { formatTime } from '@/utils/format';

interface TeleprompterCountdownProps {
  /** Seconds of prompter time left in this take; renders nothing when null. */
  remainingSeconds: number | null;
}

const WARNING_THRESHOLD_SECONDS = 30;

/**
 * Free-plan teleprompter budget, on the canvas where the prompter itself is.
 *
 * The allowance used to be visible only as toasts (at the warning thresholds)
 * and as a line inside the inspector panel — a panel that is typically closed
 * while recording. This chip makes the budget visible for the whole take, the
 * same way the transport's daily-budget indicator made the recording budget
 * visible. Creator users never see it (their allowance is unlimited).
 *
 * Like every per-second read-out in the studio, the ticking value is kept out
 * of live regions; the threshold toasts carry the announcements.
 */
export function TeleprompterCountdown({ remainingSeconds }: TeleprompterCountdownProps) {
  if (remainingSeconds === null || remainingSeconds <= 0) return null;

  const isWarning = remainingSeconds <= WARNING_THRESHOLD_SECONDS;

  return (
    <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-20">
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/[0.08] ${
          isWarning ? 'text-warning' : 'text-white/85'
        }`}
        role="timer"
        aria-label={`Teleprompter time remaining in this recording: ${formatTime(Math.floor(remainingSeconds))}`}
        aria-live="off"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide">Prompter</span>
        <span className="text-[11px] font-mono tabular-nums">
          {formatTime(Math.floor(remainingSeconds))}
        </span>
      </div>
    </div>
  );
}
