'use client';

import { formatTime } from '@/utils/format';

const WARNING_THRESHOLD_SECONDS = 120;

interface DailyRecordingIndicatorProps {
  remainingSeconds: number | null;
  totalSeconds: number;
  isRecording?: boolean;
  variant?: 'full' | 'compact';
}

function clampSeconds(value: number): number {
  return Math.max(0, Math.floor(value));
}

export function DailyRecordingIndicator({
  remainingSeconds,
  totalSeconds,
  isRecording = false,
  variant = 'full',
}: DailyRecordingIndicatorProps) {
  if (remainingSeconds === null) {
    const label = 'Creator plan: unlimited recording';
    return (
      <div role="status" aria-live="off" aria-label={label} className="flex items-center shrink-0">
        <span className="text-[11px] sm:text-[12px] text-text-secondary whitespace-nowrap">
          Creator · Unlimited recording
        </span>
      </div>
    );
  }

  const remaining = clampSeconds(remainingSeconds);
  const total = Math.max(1, Math.floor(totalSeconds));
  const isWarning = remaining > 0 && remaining <= WARNING_THRESHOLD_SECONDS;
  const isExhausted = remaining <= 0;
  const statusClass = isExhausted || isWarning
    ? 'text-warning font-semibold'
    : 'text-text-primary';
  const fillClass = isExhausted ? 'bg-recording' : isWarning ? 'bg-warning' : 'bg-accent';

  const remainingText = formatTime(remaining);
  const totalText = formatTime(total);
  const percent = Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));

  const label = isRecording
    ? `Recording: ${remainingText} remaining today`
    : `Free plan: ${remainingText} of ${totalText} recording time available today`;

  if (variant === 'compact') {
    return (
      <span
        role="status"
        aria-live="off"
        aria-label={label}
        className={`text-[10px] font-medium tabular-nums whitespace-nowrap min-w-0 truncate ${statusClass}`}
      >
        {isRecording ? `● ${remainingText} left` : `Free · ${remainingText}`}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="off"
      aria-label={label}
      className="flex flex-col items-end gap-1 min-w-0 shrink-0"
    >
      <span className={`text-[11px] sm:text-[12px] font-medium tabular-nums whitespace-nowrap ${statusClass}`}>
        {isRecording
          ? `● Recording · ${remainingText} remaining today`
          : `Free · ${remainingText} / ${totalText} min available today`}
      </span>
      <div className="flex items-center gap-2 w-full max-w-[150px]">
        <span className="text-[9px] uppercase tracking-wide text-text-muted whitespace-nowrap">
          {isRecording ? 'Remaining time' : 'Free recording time'}
        </span>
        <div
          role="progressbar"
          aria-label="Free daily recording time remaining"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={remaining}
          className="flex-1 h-1 rounded-full bg-border-default overflow-hidden"
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${fillClass}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}