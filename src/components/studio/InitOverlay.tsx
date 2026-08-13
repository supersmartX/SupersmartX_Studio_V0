'use client';

import { Button } from '@/components/ui/Button';
import { CameraIcon } from '@/components/icons';

type InitStatus = 'idle' | 'requesting' | 'permission-denied' | 'devices-unavailable' | 'error';

interface InitOverlayProps {
  onInitialize: () => void;
  status: InitStatus;
  errorMessage?: string | null;
}

export function InitOverlay({ onInitialize, status, errorMessage }: InitOverlayProps) {
  const title =
    status === 'permission-denied'
      ? 'Permission Required'
      : status === 'devices-unavailable'
      ? 'Device Not Found'
      : 'Studio Ready';

  const description =
    status === 'permission-denied'
      ? 'Camera or microphone permission is required. Please allow access in your browser settings and retry.'
      : status === 'devices-unavailable'
      ? 'No camera or microphone was detected. Connect a device and retry, then press the button below.'
      : 'Enable your camera and microphone to begin recording. Everything stays on your device.';

  const buttonLabel =
    status === 'permission-denied' || status === 'devices-unavailable'
      ? 'Retry Initialization'
      : 'Enable Camera & Microphone';

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-canvas/90 backdrop-blur-md">
      <div className="bg-surface border border-border-default rounded-xl p-8 shadow-2xl flex flex-col items-center text-center max-w-sm mx-4 animate-scale-in">
        <div className="w-14 h-14 bg-elevated rounded-full flex items-center justify-center mb-5 border border-border-subtle">
          <CameraIcon className="w-7 h-7 text-text-secondary" />
        </div>
        <h3 className="text-base font-semibold text-text-primary mb-1.5">
          {title}
        </h3>
        <p className="text-[13px] text-text-secondary mb-4 leading-relaxed">
          {description}
        </p>
        {errorMessage && (
          <div className="bg-error/10 border border-error/20 rounded-lg px-3 py-2 mb-4 text-[12px] text-error text-left w-full">
            {errorMessage}
          </div>
        )}
        <Button
          variant="primary"
          size="lg"
          onClick={onInitialize}
          className="w-full"
        >
          {buttonLabel}
        </Button>
        <p className="text-[11px] text-text-muted mt-4 max-w-xs leading-relaxed">
          Your script is saved locally so you can return later and continue where you left off.
        </p>
      </div>
    </div>
  );
}
