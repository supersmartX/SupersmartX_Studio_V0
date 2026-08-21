'use client';

import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

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
