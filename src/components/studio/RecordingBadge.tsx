import type { RecordingState } from '@/types';

interface RecordingBadgeProps {
  recordingState: RecordingState;
}

/**
 * The single at-a-glance state pill on the camera. Dark glass (not a tinted
 * red/warning wash) so it stays legible over any frame — a translucent red pill
 * disappeared over bright video. The pulsing dot carries the "live" signal;
 * the transport intentionally does not repeat it.
 *
 * Positioned by Canvas in the same top rail as Focus View (one 44px row). It
 * used to own a second row at top-14/top-16, which pushed the teleprompter's
 * safe area to 104px — on a phone preview that was half the canvas.
 */
export function RecordingBadge({ recordingState }: RecordingBadgeProps) {
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';

  if (!isRecording && !isPaused) return null;

  return (
    <div className="animate-fade-in" role="status" aria-live="polite">
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md ring-1 ring-white/[0.08] shadow-md">
        <span className={`relative flex h-2 w-2 ${isRecording ? 'animate-pulse-recording' : ''}`}>
          <span className={`inline-flex h-full w-full rounded-full ${isRecording ? 'bg-recording' : 'bg-warning'}`} />
        </span>
        <span className="text-[10px] font-semibold tracking-[0.08em] text-white/90">
          {isRecording ? 'REC' : 'PAUSED'}
        </span>
      </div>
    </div>
  );
}
