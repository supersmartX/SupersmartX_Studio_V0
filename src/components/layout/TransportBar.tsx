'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import type { RecordingState } from '@/types';
import { formatTime } from '@/utils/format';
import { DailyRecordingIndicator } from '@/components/studio/DailyRecordingIndicator';
import {
  MicrophoneIcon,
  MicrophoneOffIcon,
  RecordIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from '@/components/icons';

/**
 * Stable id for the line that names the current Start blocker.
 *
 * Exported because it is the `aria-describedby` target of the Start button and
 * therefore part of this component's accessibility contract: it is rendered by
 * the transport itself, so it exists whenever `canRecord` is false and the
 * description can never point at a missing element.
 */
export const RECORD_BLOCKER_HINT_ID = 'studio-record-blocker-hint';

interface TransportBarProps {
  recordingState: RecordingState;
  canRecord: boolean;
  hasRecording: boolean;
  isMicMuted: boolean;
  elapsedSeconds: number;
  dailyRemainingSeconds?: number | null;
  dailyRemainingTotalSeconds?: number;
  /**
   * UX-002: why Start is unavailable right now, already resolved from real
   * application state by the caller. `null` renders no hint and no description.
   * Kept as a prop so this bar never has to know *why* it is disabled.
   */
  recordBlockerHint?: string | null;
  onMicToggle: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onConfirmStop?: () => void;
}

export function TransportBar({
  recordingState,
  canRecord,
  hasRecording,
  isMicMuted,
  elapsedSeconds,
  dailyRemainingSeconds,
  dailyRemainingTotalSeconds = 600,
  recordBlockerHint = null,
  onMicToggle,
  onStart,
  onPause,
  onResume,
  onStop,
  onConfirmStop,
}: TransportBarProps) {
  const isIdle = recordingState === 'idle' || recordingState === 'completed';
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const [confirmStop, setConfirmStop] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A tap always STARTS a take; stopping is always an explicit Stop. The old
  // "hold 500ms to start, release to stop" pattern raced the 3-2-1 countdown and
  // dropped accidental near-empty takes: releasing during the countdown left a
  // silently running camera, and holding into the take instantly discarded it.
  const handleStopClick = useCallback(() => {
    if (confirmStop) {
      setConfirmStop(false);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      onConfirmStop ? onConfirmStop() : onStop();
    } else {
      setConfirmStop(true);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmStop(false);
      }, 3000);
    }
  }, [confirmStop, onStop, onConfirmStop]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  return (
    <footer className="h-14 sm:h-16 border-t border-border-subtle bg-surface flex items-center px-3 sm:px-6 shrink-0" aria-label="Recording controls">
      {/* Left: Timer + Status (secondary information) */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 sm:min-w-[160px]">
        {isRecording && (
          <div className="flex items-center gap-2 animate-fade-in">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-recording opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-recording" />
            </span>
          </div>
        )}
        {(isRecording || isPaused || elapsedSeconds > 0) && (
          <div className="flex flex-col min-w-0">
            <span className="text-[15px] sm:text-[17px] font-mono font-bold text-text-primary tabular-nums">
              {formatTime(elapsedSeconds)}
            </span>
            {isRecording && (
              <span className="text-[10px] text-text-muted">Recording</span>
            )}
            {isPaused && (
              <span className="text-[10px] text-warning">Paused</span>
            )}
          </div>
        )}
        {isIdle && !hasRecording && (
          <div className="flex flex-col min-w-0">
            <span className="text-[15px] sm:text-[17px] font-mono font-bold text-text-primary tabular-nums">00:00</span>
            <span className="text-[11px] text-text-muted">Ready</span>
          </div>
        )}
      </div>

      {/* Center: Primary action — this is the focal point */}
      <div className="relative flex-1 flex items-center justify-center gap-3 sm:gap-4">
        {/* UX-002: a disabled Start used to be a dimmed circle whose only
            explanation lived inside the canvas. This line is anchored to the
            transport itself, so the reason for the disabled state is readable
            here without hunting for it. Absolutely positioned above the bar so
            the fixed-height footer (and therefore the canvas) never reflows. */}
        {recordBlockerHint && (
          <p
            id={RECORD_BLOCKER_HINT_ID}
            // `aria-describedby` alone is not enough here: a DISABLED button
            // cannot take keyboard focus, so its description is only ever read
            // in browse mode — never announced when the user is on the control.
            // This line does change under the user (permission asked → granted
            // or refused), so it announces that transition politely, matching
            // the repo's transient-state pattern (Toast, RecordingBadge).
            // Polite, not assertive: it explains, it does not interrupt, and
            // the hint unmounting when Start enables produces no announcement.
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 max-w-[min(24rem,calc(100vw-2rem))] rounded-md border border-border-subtle bg-surface/95 px-2.5 py-1 text-center text-[11px] leading-snug font-medium text-text-secondary shadow-lg backdrop-blur-sm"
          >
            {recordBlockerHint}
          </p>
        )}
        {/* Mic toggle — secondary, positioned left of primary action */}
        <button
          onClick={onMicToggle}
          aria-pressed={isMicMuted}
          aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center ${
            isMicMuted ? 'text-recording' : 'text-text-muted hover:text-text-secondary hover:bg-elevated'
          }`}
        >
          {isMicMuted ? (
            <MicrophoneOffIcon className="w-4 h-4" />
          ) : (
            <MicrophoneIcon className="w-4 h-4" />
          )}
        </button>

        {isIdle && (
          <button
            onClick={onStart}
            disabled={!canRecord}
            className="flex items-center justify-center w-14 h-14 rounded-full bg-recording hover:bg-red-600 text-white transition-all shadow-lg shadow-recording/30 disabled:opacity-40 disabled:cursor-not-allowed select-none"
            aria-label="Start Recording"
            // Describes the disabled state from the element the screen reader is
            // already on, instead of making the user leave it to find out why.
            aria-describedby={recordBlockerHint ? RECORD_BLOCKER_HINT_ID : undefined}
          >
            <RecordIcon className="w-6 h-6" />
          </button>
        )}

        {isRecording && (
          <button
            onClick={handleStopClick}
            className={`flex items-center justify-center w-14 h-14 rounded-full text-white transition-all shadow-lg ${
              confirmStop
                ? 'bg-recording shadow-recording/40 animate-pulse'
                : 'bg-recording hover:bg-red-600 shadow-recording/30'
            }`}
            aria-label="Stop Recording"
          >
            {confirmStop ? (
              <span className="text-[11px] font-bold">OK?</span>
            ) : (
              <StopIcon className="w-6 h-6" />
            )}
          </button>
        )}

        {isPaused && (
          <button
            onClick={onResume}
            className="flex items-center justify-center w-14 h-14 rounded-full bg-accent hover:bg-accent-hover text-white transition-all shadow-lg shadow-accent/30"
            aria-label="Resume Recording"
          >
            <PlayIcon className="w-6 h-6" />
          </button>
        )}

        {/* Pause/Stop (secondary) — positioned right of primary action */}
        {isRecording && (
          <button
            onClick={onPause}
            aria-label="Pause Recording"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center ${
              confirmStop
                ? 'text-text-muted'
                : 'text-text-muted hover:text-text-secondary hover:bg-elevated'
            }`}
          >
            <PauseIcon className="w-4 h-4" />
          </button>
        )}

        {isPaused && (
          <button
            onClick={handleStopClick}
            // Stable accessible name: the visible label arms Stop → Confirm,
            // but screen readers always hear "Stop Recording".
            aria-label="Stop Recording"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center ${
              confirmStop
                ? 'text-recording bg-recording/10 animate-pulse'
                : 'text-text-muted hover:text-recording hover:bg-recording/10'
            }`}
          >
            <StopIcon className="w-4 h-4" />
            <span className="text-[10px] font-medium">{confirmStop ? 'Confirm' : 'Stop'}</span>
          </button>
        )}
      </div>

      {/* Right: Daily recording allowance (contextual info).
          UX-010: this used to be `hidden sm:flex` while a second `sm:hidden`
          compact copy lived in the left status cluster — one fact, two
          role="status" nodes. There is now one mount, visible at every width;
          the component varies its own text length instead. */}
      <div className="flex items-center justify-end min-w-0 pl-2 sm:pl-3 shrink-0">
        {dailyRemainingSeconds !== undefined && (
          <DailyRecordingIndicator
            remainingSeconds={dailyRemainingSeconds}
            totalSeconds={dailyRemainingTotalSeconds}
            isRecording={isRecording || isPaused}
          />
        )}
      </div>
    </footer>
  );
}
