'use client';

import { forwardRef } from 'react';
import type { TeleprompterSettings } from '@/types';
import { TELEPROMPTER_SAFE_TOP_PX } from '@/constants';

interface TeleprompterOverlayProps {
  script: string;
  settings: TeleprompterSettings;
  containerMaxWidth?: number;
}

export const TeleprompterOverlay = forwardRef<HTMLDivElement, TeleprompterOverlayProps>(
  function TeleprompterOverlay({ script, settings, containerMaxWidth }, ref) {
    const effectiveWidth = containerMaxWidth
      ? Math.min(settings.areaWidth, Math.max(0, containerMaxWidth - 48))
      : settings.areaWidth;

    // The guideway is positioned as a percentage of the CANVAS height, while
    // the scroll surface is only `areaHeight` of that canvas. A percentage in
    // `padding-top` resolves against WIDTH, so the first line never landed on
    // the guideway. A spacer inside the (definite-height) scroll surface is
    // height-based and keeps the two aligned at every viewport.
    const readingAreaPercent = Math.max(1, settings.areaHeight);
    const startSpacerPercent =
      (Math.max(0, settings.textStartPosition) / readingAreaPercent) * 100;
    // `max()` keeps the configured eye line on tall canvases, but lifts it
    // below the top control rail on short 16:9 previews (phones).
    const startPosition = `max(${startSpacerPercent}%, ${TELEPROMPTER_SAFE_TOP_PX}px)`;
    // At maximum scroll the LAST line comes to rest on that same line, so the
    // tail is not read under the controls or in the top fade.
    const endSpacer =
      `max(0px, calc(100% - ${startPosition}))`;

    return (
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" aria-label="Teleprompter script" aria-live="off">
        <div
          ref={ref}
          className="absolute top-0 left-0 right-0 bottom-0 overflow-y-auto overflow-x-hidden focus-mask"
          style={{ height: `${settings.areaHeight}%` }}
        >
          <div
            aria-hidden="true"
            data-testid="teleprompter-start-spacer"
            style={{ height: startPosition }}
          />
          <div
            data-testid="teleprompter-text"
            className="w-full mx-auto px-3 sm:px-6 font-semibold leading-[1.28] whitespace-pre-wrap break-words"
            style={{
              // The creator's Font Size is an upper bound on phones and
              // tablets: 32px was physically too large there. Height matters
              // as much as width — a landscape phone preview is only ~250px
              // tall, and a width-only clamp left ~1 line of script in the
              // reading band. The 5vh cap keeps two to four lines visible there
              // and changes nothing on tablet/desktop, where the chosen size
              // still wins.
              fontSize: `clamp(20px, min(4.2vw, 5vh), ${settings.fontSize}px)`,
              maxWidth: `${effectiveWidth}px`,
              fontFamily: settings.fontFamily,
              color: settings.textColor,
              textAlign: settings.textAlignment,
              // A crisp edge plus a soft halo stays legible over bright,
              // dark and skin-tone footage without the old heavy 8px shadow.
              textShadow:
                '0 1px 2px rgba(0, 0, 0, 0.9), 0 4px 18px rgba(0, 0, 0, 0.45)',
            }}
          >
            {script}
          </div>
          {/* The tail spacer mirrors the start line: at maximum scroll the
              last line comes to rest on the focal line, which is exactly when
              reading ends. */}
          <div aria-hidden="true" data-testid="teleprompter-end-spacer" style={{ height: endSpacer }} />
        </div>
      </div>
    );
  }
);
