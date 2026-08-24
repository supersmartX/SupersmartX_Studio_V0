'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { PauseIcon, PlayIcon } from '@/components/icons';
import { formatTime } from '@/utils/format';
import type { AspectRatio } from '@/types';
import { ASPECT_RATIO_PRESETS } from '@/constants';
import { GUEST_PREVIEW_MAX_SECONDS } from '@/lib/preview';

interface VideoPlayerProps {
  videoUrl: string;
  recordedDuration: number;
  onError: (msg: string) => void;
  aspectRatio: AspectRatio;
  isPreview?: boolean;
  maxPreviewSeconds?: number;
}

export function VideoPlayer({
  videoUrl,
  recordedDuration,
  onError,
  aspectRatio,
  isPreview = false,
  maxPreviewSeconds = GUEST_PREVIEW_MAX_SECONDS,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const fullscreenRef = useRef(false);
  const [isValidated, setIsValidated] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      setControlsVisible(false);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    } else {
      showControls();
    }
  }, [controlsVisible, showControls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      const videoDur = video.duration;
      const validVideoDuration = videoDur && !isNaN(videoDur) && videoDur !== Infinity;
      const effectiveDuration = recordedDuration > 0 ? recordedDuration :
        (validVideoDuration ? videoDur : 0);

      if (effectiveDuration <= 0) {
        setValidationError('Invalid video duration');
        onError('Could not read video metadata');
        return;
      }

      setDuration(effectiveDuration);
      setIsValidated(true);
    };

    const handleTimeUpdate = () => {
      const video = videoRef.current;
      if (!video) return;
      setCurrentTime(video.currentTime);
      if (isPreview && video.currentTime >= maxPreviewSeconds) {
        video.pause();
        video.currentTime = maxPreviewSeconds;
      }
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    const handleError = () => {
      setValidationError('Failed to load video');
      onError('Video playback failed');
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [videoUrl, recordedDuration, onError, isPreview, maxPreviewSeconds]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      fullscreenRef.current = !!document.fullscreenElement;
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !bar || !Number.isFinite(duration)) return;
    const rect = bar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const limit = isPreview ? maxPreviewSeconds : duration;
    video.currentTime = percent * limit;
  }, [duration, isPreview, maxPreviewSeconds]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const val = parseFloat(e.target.value);
    video.volume = val;
    setVolume(val);
    if (val > 0 && video.muted) {
      video.muted = false;
      setIsMuted(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const changeSpeed = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  }, []);

  const skip = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(duration)) return;
    const limit = isPreview ? maxPreviewSeconds : duration;
    video.currentTime = Math.max(0, Math.min(limit, video.currentTime + seconds));
  }, [duration, isPreview, maxPreviewSeconds]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  const displayDuration = isPreview ? Math.min(duration, maxPreviewSeconds) : duration;
  const progress = displayDuration > 0 ? (currentTime / displayDuration) * 100 : 0;

  if (validationError) {
    return (
      <div className={`${ASPECT_RATIO_PRESETS[aspectRatio].cssClass} bg-canvas rounded-lg flex items-center justify-center`}>
        <p className="text-sm text-recording">{validationError}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative bg-black rounded-lg overflow-hidden group" onMouseMove={showControls}>
      <video
        ref={videoRef}
        src={videoUrl}
        className={`w-full ${ASPECT_RATIO_PRESETS[aspectRatio].cssClass} object-contain`}
        onClick={toggleControls}
        playsInline
        onContextMenu={(e) => isPreview && e.preventDefault()}
        disablePictureInPicture={isPreview}
        controlsList={isPreview ? 'nodownload noremoteplayback' : undefined}
      />

      {isPreview && (
        <div className="absolute top-2 right-2 z-10 px-2 py-1 rounded bg-black/60 backdrop-blur-sm text-[10px] font-semibold text-white/80 uppercase tracking-wider select-none pointer-events-none">
          Preview
        </div>
      )}

      {!isValidated && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-white/70">Loading...</span>
          </div>
        </div>
      )}

      {isValidated && (
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 transition-opacity ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div
            ref={progressRef}
            className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer mb-2 group/progress"
            onClick={handleSeek}
          >
            <div
              className="h-full bg-accent rounded-full relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="text-white hover:text-accent transition-colors">
                {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
              </button>

              {!isPreview && (
                <>
                  <button onClick={() => skip(-10)} aria-label="Skip back 10 seconds" className="text-white/70 hover:text-white text-xs font-mono">
                    -10s
                  </button>
                  <button onClick={() => skip(10)} aria-label="Skip forward 10 seconds" className="text-white/70 hover:text-white text-xs font-mono">
                    +10s
                  </button>
                </>
              )}

              <div className="flex items-center gap-1">
                <button onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'} className="text-white/70 hover:text-white">
                  {isMuted || volume === 0 ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 accent-accent cursor-pointer"
                />
              </div>

              <span className="text-micro text-white/60 font-mono">
                {formatTime(currentTime)} / {formatTime(displayDuration)}
                {isPreview && <span className="text-white/40 ml-1">(preview)</span>}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!isPreview && (
                <div className="relative">
                  <button
                    onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                    className="text-micro text-white/70 hover:text-white font-mono px-1.5 py-0.5 rounded bg-white/10"
                  >
                    {playbackRate}x
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-full right-0 mb-1 bg-surface border border-border-default rounded-lg shadow-xl py-1 z-10">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changeSpeed(rate)}
                          className={`block w-full px-3 py-1.5 text-xs text-left hover:bg-elevated transition-colors ${
                            playbackRate === rate ? 'text-accent' : 'text-text-secondary'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button onClick={toggleFullscreen} className="text-white/70 hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
