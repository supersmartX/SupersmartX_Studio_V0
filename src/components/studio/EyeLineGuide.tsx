'use client';

// Subtle eye-line recording aid: a small green guide near the top-center of
// the camera view (where front cameras sit) reminding the reader where to
// look. DOM overlay only — the exported video is encoded from the recorded
// Blob, so this never appears in output.
export function EyeLineGuide() {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-col items-center gap-1"
      aria-hidden="true"
    >
      <span className="block h-1 w-24 rounded-full bg-gradient-to-r from-transparent via-green-400/80 to-transparent shadow-[0_0_12px_rgba(74,222,128,0.55)]" />
      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-green-300/70">
        Eye line
      </span>
    </div>
  );
}
