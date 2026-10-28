'use client';

import {
  isMediaRecorderSupported,
  selectRecordingCodec,
} from '@/lib/recording/codec-capability';

/**
 * Recording preflight (Phase 12).
 *
 * A REAL readiness check that runs in milliseconds at record-start time —
 * no device probing that could block capture, only checks already proven by
 * the moment preflight runs (a live stream means permissions + devices were
 * already granted). Storage headroom is the only async probe; on browsers
 * without the Storage Manager API it reports "unknown" instead of guessing.
 */

export type PreflightIssueSeverity = 'fatal' | 'warning';

export interface PreflightIssue {
  id: string;
  severity: PreflightIssueSeverity;
  /** Human-readable, actionable (Navigation/UI copies it verbatim). */
  message: string;
}

export interface PreflightResult {
  ready: boolean;
  issues: PreflightIssue[];
  /** The codec that WILL be used (real selection, not a display guess). */
  mimeType: string | null;
}

export interface PreflightInput {
  /** The live stream the take would record from. */
  stream: MediaStream | null;
}

const STORAGE_LOW_RATIO = 0.9;

export async function runRecordingPreflight({ stream }: PreflightInput): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  if (!isMediaRecorderSupported()) {
    issues.push({
      id: 'media-recorder-unsupported',
      severity: 'fatal',
      message: 'This browser cannot record video. Try the latest Chrome, Edge, Firefox or Safari.',
    });
  }

  const codec = selectRecordingCodec();
  if (isMediaRecorderSupported() && !codec) {
    issues.push({
      id: 'no-supported-codec',
      severity: 'fatal',
      message: 'This browser has no supported video format for recording. Try the latest Chrome or Edge.',
    });
  }

  const hasVideo = !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
  const hasAudio = !!stream && stream.getAudioTracks().some((t) => t.readyState === 'live');
  if (!stream || (!hasVideo && !hasAudio)) {
    issues.push({
      id: 'no-live-tracks',
      severity: 'fatal',
      message: 'Camera and microphone are not active. Enable them on the canvas, then try again.',
    });
  }

  // IndexedDB recovery storage — best-effort: the take records fine without
  // it, so absence is a warning, never a blocker.
  if (typeof indexedDB === 'undefined') {
    issues.push({
      id: 'recovery-storage-unavailable',
      severity: 'warning',
      message: 'Local backup is unavailable in this browser mode. An interrupted recording cannot be recovered — keep the tab open until you stop.',
    });
  } else if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      if (quota > 0 && usage / quota >= STORAGE_LOW_RATIO) {
        issues.push({
          id: 'storage-low',
          severity: 'warning',
          message: 'Browser storage is nearly full. Export or clear old library items — recording may not be safely backed up locally.',
        });
      }
    } catch {
      // estimate() can reject in private modes; storage becomes "unknown" —
      // not a reason to block.
    }
  }

  return {
    ready: !issues.some((issue) => issue.severity === 'fatal'),
    issues,
    mimeType: codec?.mimeType ?? null,
  };
}
