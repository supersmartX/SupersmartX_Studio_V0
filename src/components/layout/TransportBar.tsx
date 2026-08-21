'use client';

import { useRef, useCallback } from 'react';
import type { RecordingState } from '@/types';
import { formatTime } from '@/utils/format';
import {
  MicrophoneIcon,
  MicrophoneOffIcon,
  RecordIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from '@/components/icons';

interface TransportBarProps {
  recordingState: RecordingState;
  canRecord: boolean;
  hasRecording: boolean;
  isMicMuted: boolean;
  elapsedSeconds: number;
  onMicToggle: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function TransportBar({
  recordingState,
  canRecord,
  hasRecording,
  isMicMuted,
  elapsedSeconds,
  onMicToggle,
  onStart,
  onPause,
  onResume,
  onStop,
}: TransportBarProps) {
  const isIdle = recordingState === 'idle' || recordingState === 'completed';
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldModeRef = useRef(false);

  const handleRecordMouseDown = useCallback(() => {
    isHoldModeRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      isHoldModeRef.current = true;
      onStart();
    }, 500);
  }, [onStart]);

  const handleRecordMouseUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (isHoldModeRef.current) {
      isHoldModeRef.current = false;
      if (recordingState === 'recording') onStop();
    }
  }, [recordingState, onStop]);

  return (
    <footer className="h-14 sm:h-16 border-t border-border-subtle bg-surface flex items-center px-3 sm:px-6 shrink-0" aria-label="Recording controls">
      {/* Left: Recording Status */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 sm:min-w-[160px]">
        {isRecording && (
          <div className="flex items-center gap-2 animate-fade-in">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-recording opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-recording" />
            </span>
            <span className="text-[12px] font-bold text-recording hidden sm:inline">REC</span>
          </div>
        )}
        {(isRecording || isPaused || elapsedSeconds > 0) && (
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] sm:text-[16px] font-mono font-bold text-text-primary tabular-nums">
              {formatTime(elapsedSeconds)}
            </span>
            {isRecording && (
              <span className="text-[10px] text-recording hidden sm:block">Recording...</span>
            )}
            {isPaused && (
              <span className="text-[10px] text-warning hidden sm:block">Paused</span>
            )}
          </div>
        )}
        {isIdle && !hasRecording && (
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] sm:text-[16px] font-mono font-bold text-text-primary tabular-nums">00:00</span>
            <span className="text-[10px] text-text-muted hidden sm:block">Ready to record</span>
          </div>
        )}
        {/* Audio visualizer - hidden on mobile to save space */}
        {isRecording && (
          <div className="hidden sm:flex items-end gap-0.5 h-4">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="w-0.5 bg-recording rounded-full animate-pulse"
                style={{
                  height: `${Math.random() * 12 + 4}px`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Center: Transport Controls */}
      <div className="flex-1 flex items-center justify-center gap-2 sm:gap-3">
        <button
          onClick={onMicToggle}
          aria-pressed={isMicMuted}
          aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center ${
            isMicMuted ? 'text-recording' : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          }`}
        >
          {isMicMuted ? (
            <MicrophoneOffIcon className="w-5 h-5" />
          ) : (
            <MicrophoneIcon className="w-5 h-5" />
          )}
          <span className="text-[9px] sm:text-[10px] font-medium">{isMicMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        {isIdle && (
          <button
            onClick={(e) => {
              if (!isHoldModeRef.current) onStart();
            }}
            onMouseDown={handleRecordMouseDown}
            onMouseUp={handleRecordMouseUp}
            onMouseLeave={handleRecordMouseUp}
            onTouchStart={handleRecordMouseDown}
            onTouchEnd={handleRecordMouseUp}
            disabled={!canRecord}
            className="flex items-center justify-center w-12 h-12 rounded-full bg-recording hover:bg-red-600 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-recording/30 select-none"
            aria-label="Start Recording"
          >
            <RecordIcon className="w-5 h-5" />
          </button>
        )}

        {isRecording && (
          <>
            <button
              onClick={onPause}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-recording hover:bg-red-600 text-white transition-all shadow-lg shadow-recording/30"
              aria-label="Pause Recording"
            >
              <PauseIcon className="w-5 h-5" />
            </button>
            <button
              onClick={onStop}
              className="flex flex-col items-center gap-0.5 p-2 rounded-lg text-text-secondary hover:text-recording hover:bg-recording/10 transition-colors min-w-[44px] min-h-[44px] justify-center"
            >
              <StopIcon className="w-5 h-5" />
              <span className="text-[9px] sm:text-[10px] font-medium">Stop</span>
            </button>
          </>
        )}

        {isPaused && (
          <>
            <button
              onClick={onResume}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-accent hover:bg-accent-hover text-white transition-all shadow-lg shadow-accent/30"
              aria-label="Resume Recording"
            >
              <PlayIcon className="w-5 h-5" />
            </button>
            <button
              onClick={onStop}
              className="flex flex-col items-center gap-0.5 p-2 rounded-lg text-text-secondary hover:text-recording hover:bg-recording/10 transition-colors min-w-[44px] min-h-[44px] justify-center"
            >
              <StopIcon className="w-5 h-5" />
              <span className="text-[9px] sm:text-[10px] font-medium">Stop</span>
            </button>
          </>
        )}
      </div>

      {/* Right: spacer for layout balance - hidden on mobile */}
      <div className="hidden sm:block min-w-[160px]" />
    </footer>
  );
}
