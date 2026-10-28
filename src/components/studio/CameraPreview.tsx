'use client';

import { useEffect, useRef, useState } from 'react';
import { recordRecordingDiagnostic } from '@/lib/recording/diagnostics';
import {
  createFrameObservationAccumulator,
  observePreviewFrame,
  summarizeFrameObservation,
} from '@/lib/recording/frame-observation';

interface CameraPreviewProps {
  stream: MediaStream | null;
  isMirrored?: boolean;
  focusViewEnabled: boolean;
}

export function CameraPreview({
  stream,
  isMirrored = true,
  focusViewEnabled,
}: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playError, setPlayError] = useState(false);

  useEffect(() => {
    setPlayError(false);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let frameCallbackId: number | null = null;
    const videoTrack = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks()[0] ?? null : null;
    let actualTrackFps: number | null = null;
    try {
      const fps = videoTrack?.getSettings?.().frameRate;
      actualTrackFps = typeof fps === 'number' && Number.isFinite(fps) ? fps : null;
    } catch {
      // Track FPS is unavailable in some browsers and test doubles.
    }
    const frameObservation = createFrameObservationAccumulator(30, actualTrackFps);
    if (videoRef.current && stream) {
      const video = videoRef.current;
      video.srcObject = stream;
      const observeFrame = (now: number, metadata: VideoFrameCallbackMetadata) => {
        if (cancelled) return;
        observePreviewFrame(frameObservation, now, metadata.presentedFrames);
        frameCallbackId = video.requestVideoFrameCallback(observeFrame);
      };
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameCallbackId = video.requestVideoFrameCallback(observeFrame);
      } else {
        recordRecordingDiagnostic('preview.frame-observation-unavailable', {
          actualTrackFps,
          observedPlaybackFps: null,
        });
      }
      video.play().catch(() => {
        // Attaching a fresh stream to a (re)mounted element can transiently
        // reject even with permission granted (proven by live probe:
        // remount-after-review rejected the first play() in Chromium while
        // recording proceeded fine). Retry once before declaring blocked —
        // a blind second take is worse than a 500ms delay.
        retryTimer = setTimeout(() => {
          if (cancelled || !videoRef.current) return;
          videoRef.current.play().catch(() => {
            if (!cancelled) setPlayError(true);
          });
        }, 500);
      });
    }
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (frameCallbackId !== null && videoRef.current?.cancelVideoFrameCallback) {
        videoRef.current.cancelVideoFrameCallback(frameCallbackId);
      }
      if (frameObservation.count > 0) {
        recordRecordingDiagnostic('preview.frame-observation', { ...summarizeFrameObservation(frameObservation) });
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  if (playError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-2 text-center p-4">
          <svg className="w-8 h-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-xs text-text-secondary">Camera playback blocked</span>
          <span className="text-[12px] text-text-secondary">Check browser permissions</span>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      aria-label="Camera preview"
      aria-hidden="true"
      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
        isMirrored ? 'mirrored' : ''
      } ${focusViewEnabled ? 'blur-xl opacity-40' : ''}`}
    />
  );
}
