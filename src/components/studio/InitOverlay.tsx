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
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-canvas/90 backdrop-blur-md">
      <div className="bg-surface border border-border-default rounded-xl p-5 sm:p-8 shadow-2xl flex flex-col items-center text-center w-[calc(100vw-2rem)] max-w-sm animate-scale-in">
        <div className="w-12 h-12 sm:w-14 sm:h-14 bg-elevated rounded-full flex items-center justify-center mb-4 sm:mb-5 border border-border-subtle">
          <CameraIcon className="w-6 h-6 sm:w-7 sm:h-7 text-text-secondary" />
        </div>
        <h3 className="text-sm sm:text-base font-semibold text-text-primary mb-1.5">
          {hasError ? 'Camera Access Required' : isLoading ? 'Starting Camera...' : 'Studio Ready'}
        </h3>
        <p className="text-xs sm:text-[13px] text-text-secondary mb-4 leading-relaxed">
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
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : hasError ? 'Retry' : 'Enable Camera & Microphone'}
        </Button>
        <p className="text-[10px] sm:text-[11px] text-text-muted mt-3 sm:mt-4 max-w-xs leading-relaxed">
          Your script is saved locally so you can return later and continue where you left off.
        </p>
      </div>
    </div>
  );
}