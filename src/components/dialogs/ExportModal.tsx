'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, CloseIcon, PlayIcon, PauseIcon, ShareIcon } from '@/components/icons';
import { DiscordFeedback } from './DiscordFeedback';
import { generateFilename } from '@/services/download.service';

interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  duration: number;
  hasAudio: boolean;
}

interface ExportModalProps {
  isVisible: boolean;
  videoUrl: string;
  audioUrl: string;
  recordingResult: RecordingResult | null;
  onClose: () => void;
  onPracticeAgain: () => void;
  onShare: () => void;
  showToast: (message: string) => void;
  isAuthenticated: boolean;
  onAuthRequired: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function VideoPlayer({ videoUrl, onError }: { videoUrl: string; onError: (msg: string) => void }) {
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (video.duration === Infinity || isNaN(video.duration)) {
        setValidationError('Invalid video duration');
        onError('Could not read video metadata');
        return;
      }
      setDuration(video.duration);
      setIsValidated(true);
    };

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
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
  }, [videoUrl, onError]);

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
    if (!video || !bar) return;
    const rect = bar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = percent * video.duration;
  }, []);

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
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (validationError) {
    return (
      <div className="aspect-video bg-canvas rounded-lg flex items-center justify-center">
        <p className="text-sm text-recording">{validationError}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative bg-black rounded-lg overflow-hidden group">
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full aspect-video object-contain"
        onClick={togglePlay}
        playsInline
      />

      {!isValidated && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-white/70">Loading...</span>
          </div>
        </div>
      )}

      {isValidated && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
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
              <button onClick={togglePlay} className="text-white hover:text-accent transition-colors">
                {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
              </button>

              <button onClick={() => skip(-10)} className="text-white/70 hover:text-white text-xs font-mono">
                -10s
              </button>
              <button onClick={() => skip(10)} className="text-white/70 hover:text-white text-xs font-mono">
                +10s
              </button>

              <div className="flex items-center gap-1">
                <button onClick={toggleMute} className="text-white/70 hover:text-white">
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

              <span className="text-[10px] text-white/60 font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                  className="text-[10px] text-white/70 hover:text-white font-mono px-1.5 py-0.5 rounded bg-white/10"
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

export function ExportModal({
  isVisible,
  videoUrl,
  audioUrl: _audioUrl,
  recordingResult,
  onClose,
  onPracticeAgain,
  onShare,
  showToast,
  isAuthenticated,
  onAuthRequired,
}: ExportModalProps) {
  const [isValidating, setIsValidating] = useState(true);
  const [validationPassed, setValidationPassed] = useState(false);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!isVisible || !videoUrl) {
      setIsValidating(true);
      setValidationPassed(false);
      setValidationError('');
      return;
    }

    const validate = async () => {
      setIsValidating(true);
      setValidationError('');

      try {
        const response = await fetch(videoUrl);
        const blob = await response.blob();

        if (blob.size === 0) {
          throw new Error('Video file is empty');
        }

        const video = document.createElement('video');
        const canPlay = await new Promise<boolean>((resolve) => {
          video.onloadedmetadata = () => resolve(true);
          video.onerror = () => resolve(false);
          video.src = URL.createObjectURL(blob);
          setTimeout(() => resolve(false), 5000);
        });

        if (!canPlay) {
          throw new Error('Video cannot be played');
        }

        if (video.duration === Infinity || isNaN(video.duration) || video.duration <= 0) {
          throw new Error('Invalid video duration');
        }

        setValidationPassed(true);
      } catch (err) {
        setValidationError(err instanceof Error ? err.message : 'Validation failed');
      } finally {
        setIsValidating(false);
      }
    };

    validate();
  }, [isVisible, videoUrl]);

  const handleDownload = useCallback(() => {
    if (!recordingResult) return;

    if (!isAuthenticated) {
      onAuthRequired();
      return;
    }

    const filename = generateFilename('video', recordingResult.extension);
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Downloaded: ${filename}`);
  }, [videoUrl, recordingResult, showToast, isAuthenticated, onAuthRequired]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Export recording">
      <div
        className="absolute inset-0 bg-canvas/80 backdrop-blur-md animate-fade-in"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg bg-surface border border-border-default rounded-xl shadow-2xl animate-scale-in overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary">
            {isValidating ? 'Processing...' : validationPassed ? 'Recording Ready' : 'Export Failed'}
          </h2>
          <button
            onClick={onClose}
            className="p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 flex flex-col gap-4">
          <VideoPlayer videoUrl={videoUrl} onError={setValidationError} />

          {recordingResult && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-elevated rounded-lg p-3">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Duration</span>
                <p className="text-sm font-mono text-text-primary mt-0.5">{formatTime(recordingResult.duration)}</p>
              </div>
              <div className="bg-elevated rounded-lg p-3">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Format</span>
                <p className="text-sm font-mono text-text-primary mt-0.5">.{recordingResult.extension}</p>
              </div>
              <div className="bg-elevated rounded-lg p-3">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Audio</span>
                <p className="text-sm font-mono text-text-primary mt-0.5">{recordingResult.hasAudio ? 'Microphone' : 'None'}</p>
              </div>
              <div className="bg-elevated rounded-lg p-3">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Size</span>
                <p className="text-sm font-mono text-text-primary mt-0.5">{(recordingResult.blob.size / (1024 * 1024)).toFixed(1)} MB</p>
              </div>
            </div>
          )}

          <DiscordFeedback onSuccess={showToast} />

          <div className="flex flex-col gap-2">
            {validationPassed ? (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleDownload}
                  className="w-full gap-2"
                >
                  <DownloadIcon className="w-4 h-4" />
                  {isAuthenticated ? 'Download Video' : 'Sign in to Download'}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={onShare}
                  className="w-full gap-2"
                >
                  <ShareIcon className="w-4 h-4" />
                  Share Studio Link
                </Button>
              </>
            ) : isValidating ? (
              <div className="flex items-center justify-center gap-2 py-3">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-text-secondary">Validating recording...</span>
              </div>
            ) : (
              <div className="text-center py-3">
                <p className="text-sm text-recording">{validationError || 'Recording could not be validated'}</p>
              </div>
            )}

            <Button
              variant="secondary"
              size="md"
              onClick={onPracticeAgain}
              className="w-full"
            >
              Record Again
            </Button>
          </div>

          <div className="pt-4 border-t border-border-subtle text-center">
            <p className="text-xs text-text-muted mb-3">
              Enjoying SupersmartX Studio? Support its continued development.
            </p>
            <a
              href="https://www.buymeacoffee.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FFDD00] hover:bg-[#FFEA4D] text-slate-900 rounded-lg font-semibold text-xs transition-all min-h-[44px]"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.67 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.094 13.094 0 01-1.873-.894.077.077 0 01-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 01.077-.011c3.92 1.793 8.18 1.793 12.061 0a.073.073 0 01.078.009c.12.099.246.195.373.289a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.894.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.156 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.156 2.418z" />
              </svg>
              Support SupersmartX Studio
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
