import type { RecordingState } from '@/types';

interface RecordingBadgeProps {
  recordingState: RecordingState;
}

export function RecordingBadge({ recordingState }: RecordingBadgeProps) {
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';

  if (!isRecording && !isPaused) return null;

  return (
    <div className="absolute top-3 left-3 z-20 animate-fade-in" role="status" aria-live="polite">
      <div
        className={`
          flex items-center gap-2 px-2.5 py-1 rounded-full
          backdrop-blur-md border
          ${isRecording
            ? 'bg-recording/20 border-recording/30'
            : 'bg-warning/20 border-warning/30'
          }
        `}
      >
        <span
          className={`relative flex h-2 w-2 ${
            isRecording ? 'animate-pulse-recording' : ''
          }`}
        >
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
              isRecording ? 'bg-recording animate-ping' : 'bg-warning'
            }`}
          />
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isRecording ? 'bg-recording' : 'bg-warning'
            }`}
          />
        </span>
        <span
          className={`text-[10px] font-semibold tracking-wide ${
            isRecording ? 'text-recording' : 'text-warning'
          }`}
        >
          {isRecording ? 'REC' : 'PAUSED'}
        </span>
      </div>
    </div>
  );
}
