'use client';

import { forwardRef } from 'react';
import type { TeleprompterSettings } from '@/types';

interface TeleprompterOverlayProps {
  script: string;
  settings: TeleprompterSettings;
  containerMaxWidth?: number;
}

export const TeleprompterOverlay = forwardRef<HTMLDivElement, TeleprompterOverlayProps>(
  function TeleprompterOverlay({ script, settings, containerMaxWidth }, ref) {
    const effectiveWidth = containerMaxWidth
      ? Math.min(settings.areaWidth, containerMaxWidth - 48)
      : settings.areaWidth;

    return (
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" aria-label="Teleprompter script" aria-live="off">
        <div
          ref={ref}
          className="absolute top-0 left-0 right-0 bottom-0 overflow-y-auto overflow-x-hidden focus-mask"
          style={{ height: `${settings.areaHeight}%` }}
        >
          <div
            className="w-full mx-auto px-3 sm:px-6 font-bold leading-tight drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)] whitespace-pre-wrap break-words transition-opacity duration-300"
            style={{
              fontSize: `${settings.fontSize}px`,
              paddingTop: `${settings.textStartPosition}%`,
              paddingBottom: '85%',
              maxWidth: `${effectiveWidth}px`,
              fontFamily: settings.fontFamily,
              color: settings.textColor,
              textAlign: settings.textAlignment,
            }}
          >
            {script}
          </div>
        </div>
      </div>
    );
  }
);
