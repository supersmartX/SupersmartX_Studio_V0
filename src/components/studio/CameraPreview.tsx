'use client';

import { useEffect, useRef, useState } from 'react';

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
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {
        setPlayError(true);
      });
    }
    return () => {
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
