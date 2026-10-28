'use client';

import type { RecordingBackupState } from '@/lib/recording/chunk-store';

interface RecordingStatusLineProps {
  /**
   * The ACTUAL capture configuration (real MediaStream track settings —
   * never the configured target dressed up as capture). The frame rate is
   * omitted when the track did not report one.
   */
  capture: { width: number; height: number; frameRate?: number } | null;
  /** Real state of the local recovery copy (Phase 13 — never fake). */
  backupState: RecordingBackupState;
}

/**
 * Recording status line (Phase 13, visually integrated in the clean-canvas
 * redesign): shown while a take is in flight, in the canvas corner the other
 * overlays don't use (Timer: top-right, REC pill: top-left).
 *
 * One quiet pill instead of the previous stacked chips — subtle supporting
 * information, still NEVER a dashboard: no codec names, no bitrates, no
 * recovery internals.
 *
 * Every value displayed is real: the capture geometry comes from the live
 * track's settings, and the backup line reflects the ACTUAL last write of
 * the local recovery copy — "unavailable" is shown honestly instead of a
 * fake success.
 */
export function RecordingStatusLine({ capture, backupState }: RecordingStatusLineProps) {
  if (backupState === 'inactive') return null;

  const showCapture = !!capture && capture.width > 0 && capture.height > 0;
  if (!showCapture) return null;

  return (
    <div
      className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 z-20"
      role="status"
      aria-live="off"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/[0.07] text-white/65 text-[10px] font-medium tabular-nums">
        <span>
          {capture!.width} × {capture!.height}
          {capture!.frameRate ? ` · ${capture!.frameRate} fps` : ''}
        </span>
        <span aria-hidden="true" className="opacity-30">·</span>
        {backupState === 'saved' && (
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="text-emerald-400">✓</span>
            <span>Local backup</span>
          </span>
        )}
        {backupState === 'saving' && (
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="text-white/40">…</span>
            <span>Backing up locally</span>
          </span>
        )}
        {backupState === 'unavailable' && (
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="text-amber-400">!</span>
            <span>Local backup unavailable — keep this tab open</span>
          </span>
        )}
      </div>
    </div>
  );
}
