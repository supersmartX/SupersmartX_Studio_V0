'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, CloseIcon, ShareIcon, ArrowLeftIcon } from '@/components/icons';
import { DiscordFeedback } from './DiscordFeedback';
import { VideoPlayer } from '@/components/studio/VideoPlayer';
import { generateFilename } from '@/services/download.service';
import { setPendingDownload } from '@/lib/auth-guard';
import { GUEST_PREVIEW_MAX_SECONDS } from '@/lib/preview';
import type { ExportStep, PlatformId, ExportConfig, MasterRecording, ExportJob } from '@/types';
import { PLATFORM_PRESETS } from '@/constants';
import { formatTime } from '@/utils/format';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface ExportModalProps {
  isVisible: boolean;
  masterRecording: MasterRecording | null;
  onClose: () => void;
  onPracticeAgain: () => void;
  onShare: () => void;
  showToast: (message: string) => void;
  isAuthenticated: boolean;
  userPlan: string;
  onAuthRequired: () => void;
  downloadCount: number;
  downloadLimit: number;
  onDownloadLimitReached: () => void;
  exportConfig: ExportConfig | null;
  exportJobs: ExportJob[];
  onSelectPlatform: (platformId: PlatformId) => ExportConfig;
  onUpdateCrop: (updates: { x?: number; y?: number; zoom?: number }) => void;
  onResetCrop: () => void;
  onStartExport: (master: MasterRecording) => Promise<ExportJob>;
  onStartBatchExport?: (master: MasterRecording, configs: ExportConfig[]) => Promise<ExportJob[]>;
  onCancelExport?: () => void;
}

export function ExportModal({
  isVisible,
  masterRecording,
  onClose,
  onPracticeAgain,
  onShare,
  showToast,
  isAuthenticated,
  userPlan,
  onAuthRequired,
  downloadCount: _downloadCount,
  downloadLimit: _downloadLimit,
  onDownloadLimitReached,
  exportConfig,
  exportJobs: _exportJobs,
  onSelectPlatform,
  onUpdateCrop,
  onResetCrop: _onResetCrop,
  onStartExport,
  onStartBatchExport,
  onCancelExport,
}: ExportModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isVisible, onClose);
  const [step, setStep] = useState<ExportStep>('platform');
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId | null>(null);
  const [batchPlatforms, setBatchPlatforms] = useState<PlatformId[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportJob | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const isGuest = !isAuthenticated;
  const isPreview = isGuest && (masterRecording?.duration || 0) > GUEST_PREVIEW_MAX_SECONDS;
  const canDownloadFile = isAuthenticated && userPlan !== 'free';

  const handleSelectPlatform = useCallback((platformId: PlatformId) => {
    setSelectedPlatform(platformId);
    onSelectPlatform(platformId);
    setStep('crop');
  }, [onSelectPlatform]);

  const handleToggleBatchPlatform = useCallback((platformId: PlatformId) => {
    setBatchPlatforms((prev) =>
      prev.includes(platformId)
        ? prev.filter((id) => id !== platformId)
        : [...prev, platformId]
    );
  }, []);

  const handleBatchExport = useCallback(async () => {
    if (!masterRecording || batchPlatforms.length === 0 || !onStartBatchExport) return;

    setIsExporting(true);
    setStep('encoding');

    const configs = batchPlatforms.map((pid) => {
      return onSelectPlatform(pid);
    });

    setBatchProgress({ current: 0, total: configs.length });

    try {
      const results = await onStartBatchExport(masterRecording, configs);
      const lastResult = results[results.length - 1];
      setExportResult(lastResult);
      setBatchProgress(null);

      if (lastResult.status === 'done') {
        setStep('done');
      } else {
        setStep('platform');
        showToast('Some exports failed. Check the results.');
      }
    } catch {
      setStep('platform');
      showToast('Batch export failed.');
    } finally {
      setIsExporting(false);
      setBatchProgress(null);
    }
  }, [masterRecording, batchPlatforms, onStartBatchExport, onSelectPlatform, showToast]);

  const handleExport = useCallback(async () => {
    if (!masterRecording || !exportConfig) return;

    setIsExporting(true);
    setStep('encoding');

    try {
      const result = await onStartExport(masterRecording);
      setExportResult(result);

      if (result.status === 'done') {
        setStep('done');
      } else {
        setStep('platform');
        showToast('Export failed. Please try again.');
      }
    } catch {
      setStep('platform');
      showToast('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [masterRecording, exportConfig, onStartExport, showToast]);

  const handleDownload = useCallback(() => {
    if (!exportResult?.resultUrl) return;

    if (!isAuthenticated) {
      setPendingDownload(() => doDownload());
      onAuthRequired();
      return;
    }

    if (!canDownloadFile) {
      onDownloadLimitReached();
      return;
    }

    doDownload();

    function doDownload() {
      if (!exportResult?.resultUrl) return;
      const preset = PLATFORM_PRESETS.find((p) => p.id === selectedPlatform);
      const filename = generateFilename('video', preset?.id === 'custom' ? 'webm' : 'webm');
      const a = document.createElement('a');
      a.href = exportResult.resultUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`Downloaded: ${filename}`);
    }
  }, [exportResult, isAuthenticated, canDownloadFile, selectedPlatform, onAuthRequired, onDownloadLimitReached, showToast]);

  const handleBack = useCallback(() => {
    if (step === 'crop') setStep('platform');
    if (step === 'done') setStep('platform');
  }, [step]);

  if (!shouldRender || !masterRecording) return null;

  return (
    <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Export recording" {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={closeModal}
      />

      <div className={`relative w-full max-w-lg bg-surface border border-border-default rounded-xl shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            {step !== 'platform' && (
              <button
                onClick={handleBack}
                className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors"
                aria-label="Back"
              >
                <ArrowLeftIcon className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-sm font-semibold text-text-primary">
              {step === 'platform' && 'Where are you publishing?'}
              {step === 'crop' && 'Adjust your crop'}
              {step === 'encoding' && 'Exporting...'}
              {step === 'done' && 'Export complete'}
            </h2>
          </div>
          <button
            onClick={closeModal}
            className="p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 flex flex-col gap-4">
          {step === 'platform' && (
            <>
              <VideoPlayer
                videoUrl={masterRecording.url}
                recordedDuration={masterRecording.duration}
                onError={() => {}}
                aspectRatio="16:9"
                isPreview={isPreview}
              />

              <div className="grid grid-cols-2 gap-2">
                {PLATFORM_PRESETS.filter((p) => p.id !== 'custom').map((preset) => {
                  const isSelected = batchPlatforms.includes(preset.id);
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleToggleBatchPlatform(preset.id)}
                      onDoubleClick={() => handleSelectPlatform(preset.id)}
                      className={`flex flex-col items-start p-3 rounded-lg border transition-all text-left relative ${
                        isSelected
                          ? 'bg-accent/15 border-accent/40 ring-1 ring-accent/20'
                          : 'bg-elevated hover:bg-accent/10 border-border-subtle hover:border-accent/30'
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                      <span className="text-xs font-semibold text-text-primary">{preset.label}</span>
                      <span className="text-[10px] text-text-muted mt-0.5">{preset.aspectRatio} · {preset.width}×{preset.height}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => handleSelectPlatform('custom')}
                  className="flex flex-col items-start p-3 rounded-lg bg-elevated hover:bg-accent/10 border border-border-subtle hover:border-accent/30 transition-all text-left"
                >
                  <span className="text-xs font-semibold text-text-primary">Custom</span>
                  <span className="text-[10px] text-text-muted mt-0.5">Define your own format</span>
                </button>
              </div>

              {batchPlatforms.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-text-muted">
                    {batchPlatforms.length} platform{batchPlatforms.length > 1 ? 's' : ''} selected
                  </p>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleBatchExport}
                    className="w-full gap-2"
                    disabled={isExporting}
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Export for All ({batchPlatforms.length})
                  </Button>
                </div>
              )}

              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <span>{formatTime(masterRecording.duration)}</span>
                <span>·</span>
                <span>{masterRecording.extension.toUpperCase()}</span>
                <span>·</span>
                <span>{(masterRecording.blob.size / (1024 * 1024)).toFixed(1)} MB</span>
              </div>
            </>
          )}

          {step === 'crop' && exportConfig && (
            <>
              <div className="relative bg-black rounded-lg overflow-hidden">
                <div
                  className="relative mx-auto overflow-hidden"
                  style={{
                    aspectRatio: `${exportConfig.outputWidth} / ${exportConfig.outputHeight}`,
                    maxHeight: '300px',
                  }}
                >
                  <video
                    src={masterRecording.url}
                    className="w-full h-full object-cover"
                    style={{
                      objectPosition: `${-exportConfig.crop.x}px ${-exportConfig.crop.y}px`,
                      transform: `scale(${exportConfig.crop.zoom})`,
                    }}
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onUpdateCrop({ x: exportConfig.crop.x - 50 })}
                >
                  ←
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onUpdateCrop({ x: 0, y: 0 })}
                >
                  Center
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onUpdateCrop({ x: exportConfig.crop.x + 50 })}
                >
                  →
                </Button>
                <div className="flex-1 mx-2">
                  <input
                    type="range"
                    min="1"
                    max="2"
                    step="0.1"
                    value={exportConfig.crop.zoom}
                    onChange={(e) => onUpdateCrop({ zoom: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-accent"
                  />
                  <span className="text-[10px] text-text-muted">Zoom</span>
                </div>
              </div>

              <div className="text-center text-xs text-text-muted">
                {exportConfig.aspectRatio} · {exportConfig.outputWidth}×{exportConfig.outputHeight}
              </div>

              <div className="flex flex-col gap-2">
                {isGuest ? (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={onAuthRequired}
                    className="w-full gap-2"
                    disabled={isExporting}
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Sign In to Download
                  </Button>
                ) : canDownloadFile ? (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleExport}
                    className="w-full gap-2"
                    disabled={isExporting}
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Export & Download
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={onDownloadLimitReached}
                    className="w-full gap-2"
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Upgrade to Download
                  </Button>
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
            </>
          )}

          {step === 'encoding' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-text-secondary">Creating your export...</p>
              {batchProgress && (
                <p className="text-xs text-text-muted">
                  {batchProgress.current} of {batchProgress.total} exports complete
                </p>
              )}
              <p className="text-xs text-text-muted">This may take a moment depending on video length</p>
              {onCancelExport && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    onCancelExport();
                    setStep('platform');
                    setIsExporting(false);
                    setBatchProgress(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}

          {step === 'done' && exportResult && (
            <>
              {exportResult.resultUrl && (
                <VideoPlayer
                  videoUrl={exportResult.resultUrl}
                  recordedDuration={masterRecording.duration}
                  onError={() => {}}
                  aspectRatio={exportConfig?.aspectRatio || '16:9'}
                />
              )}

              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleDownload}
                  className="w-full gap-2"
                >
                  <DownloadIcon className="w-4 h-4" />
                  Download Video
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

                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setStep('platform');
                    setExportResult(null);
                  }}
                  className="w-full"
                >
                  Export for Another Platform
                </Button>

                <Button
                  variant="secondary"
                  size="md"
                  onClick={onPracticeAgain}
                  className="w-full"
                >
                  Record Again
                </Button>
              </div>
            </>
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
        </div>
      </div>
    </div>
  );
}
