'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@/utils/format';

const WARNING_THRESHOLD_SECONDS = 120;

interface DailyRecordingIndicatorProps {
  remainingSeconds: number | null;
  totalSeconds: number;
  isRecording?: boolean;
}

function clampSeconds(value: number): number {
  return Math.max(0, Math.floor(value));
}

/**
 * UX-016 — narrow live announcement for the Free budget.
 *
 * `remaining` changes every second while recording, so the indicator's own
 * container cannot be the live region. It deliberately keeps `aria-live="off"`
 * AND its `aria-label`, which contains the device-local legal notice: making it
 * polite would re-read that static legal copy on every tick, which is both
 * unusable and exactly what "keep static legal copy out of live regions" rules
 * out.
 *
 * Only the two thresholds that change what the user should DO are announced —
 * the 2-minute warning and exhaustion — and each is spoken once on the crossing.
 * Rendered as a SIBLING of the status container, not a child, so there is no
 * nested/overlapping live region for assistive tech to reconcile.
 */
function BudgetAnnouncer({ remainingText, isWarning, isExhausted }: {
  remainingText: string;
  isWarning: boolean;
  isExhausted: boolean;
}) {
  const tier = isExhausted ? 'exhausted' : isWarning ? 'warning' : 'normal';
  const [message, setMessage] = useState('');
  const previousTier = useRef(tier);

  useEffect(() => {
    if (previousTier.current === tier) return;
    previousTier.current = tier;
    if (tier === 'exhausted') {
      setMessage("Today's Free recording allowance is used up.");
    } else if (tier === 'warning') {
      setMessage(`${remainingText} of Free recording time left today.`);
    }
  }, [tier, remainingText]);

  // Deliberately NOT role="status": that role only implies aria-live="polite",
  // and adding a second one would duplicate this indicator's status landmark
  // and make every `getByRole('status')` in the suite ambiguous. The bare live
  // region announces identically.
  return (
    <span aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </span>
  );
}

export function DailyRecordingIndicator({
  remainingSeconds,
  totalSeconds,
  isRecording = false,
}: DailyRecordingIndicatorProps) {
  if (remainingSeconds === null) {
    const label = 'Creator plan: unlimited recording duration and sessions';
    return (
      <div role="status" aria-live="off" aria-label={label} className="flex items-center shrink-0">
        <span className="text-[11px] sm:text-[12px] text-text-secondary whitespace-nowrap">
          Creator · Unlimited recording duration
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

  const localLimitNotice = 'Device-local limit; may reset if site data is cleared or you switch browser profiles.';
  const label = isRecording
    ? `Recording: ${remainingText} remaining today. ${localLimitNotice}`
    : `Free recording is limited to up to 10 minutes per browser profile per local calendar day. ${localLimitNotice} ${remainingText} of ${totalText} remaining.`;

  return (
    <>
    <div
      role="status"
      aria-live="off"
      aria-label={label}
      // UX-010: the device-local fine print used to sit permanently in the
      // layout as 9px muted legal jargon under the bar. It is still on the
      // element for assistive tech via aria-label, and now reaches sighted
      // users on hover/focus instead of permanently spending a line of the
      // transport on it. aria-live stays "off" (UX-016) — see BudgetAnnouncer.
      title={label}
      className="flex flex-col items-end gap-1 min-w-0 shrink-0"
    >
      {/* One indicator, two text lengths. Previously the transport mounted a
          `compact` AND a `full` copy and let CSS pick one, so both sat in the
          DOM as separate role="status" nodes — two budget readouts to a screen
          reader for one fact. The single mount now varies its own text. */}
      <span className={`text-[11px] sm:text-[12px] font-medium tabular-nums whitespace-nowrap ${statusClass}`}>
        {isRecording ? (
          <>
            <span className={`sm:hidden ${statusClass}`}>● {remainingText} left</span>
            <span className={`hidden sm:inline ${statusClass}`}>● Recording · {remainingText} remaining today</span>
          </>
        ) : (
          <>
            <span className={`sm:hidden ${statusClass}`}>Free · {remainingText}</span>
            <span className={`hidden sm:inline ${statusClass}`}>Free · {remainingText} / {totalText} available today</span>
          </>
        )}
      </span>
      <div className="hidden sm:flex items-center gap-2 w-full max-w-[150px]">
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
    <BudgetAnnouncer remainingText={remainingText} isWarning={isWarning} isExhausted={isExhausted} />
    </>
  );
}