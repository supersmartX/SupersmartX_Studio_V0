import { TELEPROMPTER_SAFE_TOP_PX } from '@/constants';

interface FocalGuidewayProps {
  position: number;
}

/**
 * Focal guideway — the horizontal marker for where the script should START
 * scrolling (the creator's eye line). The clean-canvas redesign keeps the
 * functional hairline and drops the previous permanent "NATURAL EYE LINE"
 * chip and its tooltip: the guideway is `pointer-events-none`, so that
 * tooltip could never actually be hovered — it was just standing decoration
 * over the video.
 */
export function FocalGuideway({ position }: FocalGuidewayProps) {
  return (
    <div
      className="absolute left-0 right-0 h-px pointer-events-none z-20"
      // Mirror the teleprompter's safe area so the line and the first script
      // line stay aligned even when the configured position would be under
      // the top controls on a short preview.
      style={{ top: `max(${position}%, ${TELEPROMPTER_SAFE_TOP_PX}px)` }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
    </div>
  );
}
