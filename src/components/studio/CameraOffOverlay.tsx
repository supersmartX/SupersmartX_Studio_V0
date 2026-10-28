'use client';

import { CameraIcon } from '@/components/icons';

interface CameraOffOverlayProps {
  /** HandleCameraToggle — the single real writer of the camera's on/off state. */
  onEnable: () => void;
  /** The transport already owns mute; the copy must not claim a live mic. */
  isMicMuted?: boolean;
}

/**
 * Camera-off state (clean-canvas redesign).
 *
 * The video TRACK is disabled, not the stream gone: the frame underneath is
 * frozen, which reads as "broken" unless the UI says otherwise. This overlay
 * is an honest, calm surface over that frozen frame — no fake stream, no
 * placeholder imagery — with the same one-writer toggle the Camera chip in
 * the transport uses, so the two can never disagree about state.
 *
 * It must not cause layout movement: it is absolutely positioned inside the
 * existing preview box, so toggling never reflows the canvas, the controls
 * or the teleprompter.
 */
export function CameraOffOverlay({ onEnable, isMicMuted = false }: CameraOffOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center p-3 bg-canvas/60 backdrop-blur-[2px]"
      role="status"
      aria-label="Camera is off"
    >
      <div className="flex max-h-full max-w-[280px] flex-col items-center gap-2 overflow-y-auto rounded-2xl bg-black/45 px-4 py-4 text-center ring-1 ring-white/[0.08] shadow-xl backdrop-blur-md">
        <CameraIcon className="w-5 h-5 text-white/55" />
        <span className="text-[13px] font-semibold text-white/90">Camera off</span>
        <span className="text-[11.5px] leading-snug text-white/55">
          {isMicMuted
            ? 'Camera and microphone are both off. Turn either back on below when you are ready.'
            : 'Your microphone is still live. Turn the camera back on below when you are ready.'}
        </span>
        <button
          onClick={onEnable}
          className="mt-1 px-3.5 py-2 rounded-full bg-white/[0.08] ring-1 ring-white/10 text-[12px] font-medium text-white/80 hover:bg-white/[0.14] hover:text-white transition-colors min-h-[44px]"
        >
          Turn camera back on
        </button>
      </div>
    </div>
  );
}
