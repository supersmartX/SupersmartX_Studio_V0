'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, CloseIcon, ShareIcon } from '@/components/icons';
import { DiscordFeedback } from './DiscordFeedback';
import { VideoPlayer } from '@/components/studio/VideoPlayer';
import { generateFilename } from '@/services/download.service';
import { setPendingDownload } from '@/lib/auth-guard';
import type { AspectRatio } from '@/types';
import { formatTime } from '@/utils/format';
import { useModalAnimation } from '@/hooks/useModalAnimation';

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
  onDownloadComplete?: () => void;
  showToast: (message: string) => void;
  isAuthenticated: boolean;
  onAuthRequired: () => void;
  downloadCount: number;
  downloadLimit: number;
  onDownloadLimitReached: () => void;
  aspectRatio: AspectRatio;
}

export function ExportModal({
  isVisible,
  videoUrl,
  audioUrl: _audioUrl,
  recordingResult,
  onClose,
  onPracticeAgain,
  onShare,
  onDownloadComplete,
  showToast,
  isAuthenticated,
  onAuthRequired,
  downloadCount,
  downloadLimit,
  onDownloadLimitReached,
  aspectRatio,
}: ExportModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isVisible, onClose);
  const [isValidating, setIsValidating] = useState(true);
  const [validationPassed, setValidationPassed] = useState(false);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!shouldRender || !videoUrl) {
      setIsValidating(true);
      setValidationPassed(false);
      setValidationError('');
      return;
    }

    const validate = () => {
      setIsValidating(true);
      setValidationError('');

      const recordedDuration = recordingResult?.duration || 0;

      if (recordedDuration <= 0) {
        setValidationError('Invalid video duration - recording may be too short');
        setIsValidating(false);
        return;
      }

      if (recordedDuration < 5) {
        setValidationError('Video too short — minimum 5 seconds to download');
        setIsValidating(false);
        return;
      }

      if (!videoUrl) {
        setValidationError('No video URL');
        setIsValidating(false);
        return;
      }

      setValidationPassed(true);
      setIsValidating(false);
    };

    validate();
  }, [shouldRender, videoUrl, recordingResult]);

  const handleDownload = useCallback(() => {
    if (!recordingResult) return;

    if (recordingResult.duration < 5) {
      showToast('Video too short — minimum 5 seconds to download');
      return;
    }

    if (downloadCount >= downloadLimit) {
      showToast(`Free plan limit: ${downloadLimit} video downloads. Upgrade for unlimited.`);
      onDownloadLimitReached();
      return;
    }

    const doDownload = () => {
      const filename = generateFilename('video', recordingResult.extension);
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`Downloaded: ${filename}`);
      onDownloadComplete?.();
    };

    if (!isAuthenticated) {
      setPendingDownload(doDownload);
      onAuthRequired();
      return;
    }

    doDownload();
  }, [videoUrl, recordingResult, showToast, isAuthenticated, onAuthRequired, onDownloadComplete, downloadCount, downloadLimit, onDownloadLimitReached]);

  if (!shouldRender) return null;

  return (
    <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Export recording" {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={closeModal}
      />

      <div className={`relative w-full max-w-lg bg-surface border border-border-default rounded-xl shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary">
            {isValidating ? 'Processing...' : validationPassed ? 'Recording Ready' : 'Export Failed'}
          </h2>
          <button
            onClick={closeModal}
            className="p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 flex flex-col gap-4">
          <VideoPlayer videoUrl={videoUrl} recordedDuration={recordingResult?.duration || 0} onError={setValidationError} aspectRatio={aspectRatio} />

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

          <details className="group">
            <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text-secondary transition-colors list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform text-[8px]">&#9654;</span>
              Have feedback?
            </summary>
            <div className="mt-2">
              <DiscordFeedback onSuccess={showToast} />
            </div>
          </details>

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
                  {isAuthenticated ? 'Download Video' : 'Create Free Account to Download'}
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
        </div>
      </div>
    </div>
  );
}
