'use client';

import { useEffect, useState } from 'react';
import { LAUNCH_PLATFORM_PRESETS, DEFAULT_PLATFORM_ID } from '@/constants';
import type { PlatformId } from '@/types';

interface RecordingFormatPickerProps {
  recordingPlatformId: PlatformId;
  onSelect: (id: PlatformId) => void;
  userPlan: string;
  onUpgradeRequired: (platformId: PlatformId) => void;
}

/**
 * Capture-time format choice. This drives the RECORDING canvas (what the
 * camera captures), not the export — "Preview as" owns the export side, so
 * the two controls never fight over the same state.
 *
 * Free records YouTube 16:9 widescreen only; every other option opens the
 * upgrade path instead of changing capture. Creator picks any launch format.
 */
export function RecordingFormatPicker({
  recordingPlatformId,
  onSelect,
  userPlan,
  onUpgradeRequired,
}: RecordingFormatPickerProps) {
  const isCreator = userPlan === 'creator_monthly' || userPlan === 'creator_yearly';
  const selected = LAUNCH_PLATFORM_PRESETS.find((p) => p.id === recordingPlatformId)
    ?? LAUNCH_PLATFORM_PRESETS.find((p) => p.id === DEFAULT_PLATFORM_ID)!;

  if (!isCreator) {
    return (
      <div className="flex items-center justify-center gap-2 pb-2">
        <span className="text-[12px] text-text-secondary">
          Recording in <span className="font-semibold text-text-primary">YouTube · 16:9 widescreen</span>
        </span>
        <button
          type="button"
          onClick={() => onUpgradeRequired('youtube-shorts')}
          className="text-[12px] font-medium text-accent-text hover:underline"
        >
          All formats with Creator
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 pb-2">
      <label htmlFor="recording-format" className="text-[12px] text-text-secondary">
        Recording format
      </label>
      <select
        id="recording-format"
        value={selected.id}
        onChange={(e) => onSelect(e.target.value as PlatformId)}
        className="rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-[12px] font-medium text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {LAUNCH_PLATFORM_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label} · {preset.sublabel}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Free-only handheld nudge: a widescreen-only plan on a portrait-held phone
 * produces a postage-stamp capture. Ask the user to rotate; never blocks —
 * the camera keeps working for users who cannot rotate.
 */
export function FreeRotateNudge() {
  const [isPortrait, setIsPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!isPortrait || dismissed) return null;

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2" role="status">
      <p className="text-[12px] text-text-secondary">
        <span className="font-semibold text-text-primary">Rotate your device</span> for widescreen
        recording — Free records YouTube 16:9.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss rotate suggestion"
        className="rounded-md px-2 py-1 text-[12px] text-text-muted hover:text-text-primary hover:bg-elevated min-w-[44px] min-h-[44px]"
      >
        ✕
      </button>
    </div>
  );
}
