'use client';

import { Button } from '@/components/ui/Button';
import { CameraIcon } from '@/components/icons';

type InitStatus = 'idle' | 'requesting' | 'ready' | 'error';

interface InitOverlayProps {
  onInitialize: () => void;
  status: InitStatus;
  errorMessage?: string | null;
}

export function InitOverlay({ onInitialize, status, errorMessage }: InitOverlayProps) {
  const isLoading = status === 'requesting';
  const hasError = status === 'error';

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-canvas/90 backdrop-blur-md overflow-auto">
      <div
        className="bg-surface border border-border-default rounded-xl shadow-2xl flex flex-col items-center text-center animate-scale-in w-full"
        style={{
          padding: 'clamp(1rem, 4vw, 2rem)',
          maxWidth: 'min(24rem, 90vw)',
        }}
      >
        <div
          className="bg-elevated rounded-full flex items-center justify-center border border-border-subtle shrink-0"
          style={{
            width: 'clamp(2.5rem, 6vw, 3.5rem)',
            height: 'clamp(2.5rem, 6vw, 3.5rem)',
            marginBottom: 'clamp(0.75rem, 3vw, 1.25rem)',
          }}
        >
          <CameraIcon className="w-5 h-5 sm:w-6 sm:h-7 md:w-7 md:h-7 text-text-secondary" />
        </div>
        <h3
          className="font-semibold text-text-primary leading-snug"
          style={{
            fontSize: 'clamp(0.8125rem, 2vw, 1rem)',
            marginBottom: 'clamp(0.25rem, 1vw, 0.5rem)',
          }}
        >
          {hasError ? 'Camera Access Required' : isLoading ? 'Starting Camera...' : 'Studio Ready'}
        </h3>
        <p
          className="text-text-secondary leading-relaxed"
          style={{
            fontSize: 'clamp(0.6875rem, 1.5vw, 0.8125rem)',
            marginBottom: 'clamp(0.75rem, 2.5vw, 1.25rem)',
          }}
        >
          {hasError
            ? errorMessage ?? 'Unable to access camera. Please retry.'
            : isLoading
            ? 'Please allow camera and microphone access when prompted.'
            : 'Enable your camera and microphone to begin recording. Everything stays on your device.'}
        </p>
        <Button
          variant="primary"
          size="lg"
          onClick={onInitialize}
          className="w-full shrink-0"
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : hasError ? 'Retry' : 'Enable Camera & Microphone'}
        </Button>
        <p
          className="text-text-muted leading-relaxed hidden sm:block"
          style={{
            fontSize: 'clamp(0.625rem, 1.2vw, 0.6875rem)',
            marginTop: 'clamp(0.5rem, 2vw, 1rem)',
            maxWidth: '20rem',
          }}
        >
          Your script is saved locally so you can return later and continue where you left off.
        </p>
      </div>
    </div>
  );
}