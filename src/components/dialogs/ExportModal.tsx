'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, CloseIcon, ShareIcon, ArrowLeftIcon } from '@/components/icons';
import { DiscordFeedback } from './DiscordFeedback';
import { VideoPlayer } from '@/components/studio/VideoPlayer';
import { generateFilename } from '@/services/download.service';
import { setPendingDownload } from '@/lib/auth-guard';
import { GUEST_PREVIEW_MAX_SECONDS } from '@/lib/preview';
import { getEntitlements } from '@/lib/entitlements';
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
  onDownloadLimitReached: () => void;
  exportConfig: ExportConfig | null;
  onSelectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }) => ExportConfig;
  onUpdateCrop: (updates: { x?: number; y?: number; zoom?: number }) => void;
  onStartExport: (master: MasterRecording, onProgress?: (progress: number) => void, watermarkRequired?: boolean) => Promise<ExportJob>;
  onStartBatchExport?: (master: MasterRecording, configs: ExportConfig[], onProgress?: (batchIndex: number, progress: number) => void, watermarkRequired?: boolean) => Promise<ExportJob[]>;
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
  onDownloadLimitReached,
  exportConfig,
  onSelectPlatform,
  onUpdateCrop,
  onStartExport,
  onStartBatchExport,
  onCancelExport,
}: ExportModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isVisible, onClose);
  const [step, setStep] = useState<ExportStep>('platform');
  const [batchPlatforms, setBatchPlatforms] = useState<PlatformId[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportJob | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [exportProgress, setExportProgress] = useState(0);

  const isGuest = !isAuthenticated;
  const isPreview = isGuest && (masterRecording?.duration || 0) > GUEST_PREVIEW_MAX_SECONDS;
  const canDownloadFile = isAuthenticated && userPlan !== 'free';
  const entitlementsView = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
  const canBatch = entitlementsView.canBatchExport;

  const handleSelectPlatform = useCallback((platformId: PlatformId) => {
    if (isGuest) {
      onAuthRequired();
      return;
    }
    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    if (!entitlements.canExport) {
      onDownloadLimitReached();
      return;
    }
    const srcW = masterRecording?.sourceWidth || 1920;
    const srcH = masterRecording?.sourceHeight || 1080;
    onSelectPlatform(platformId, srcW, srcH, entitlements.maxResolution);
    setStep('crop');
  }, [isGuest, onSelectPlatform, masterRecording, userPlan, onAuthRequired, onDownloadLimitReached]);

  const handleToggleBatchPlatform = useCallback((platformId: PlatformId) => {
    setBatchPlatforms((prev) =>
      prev.includes(platformId)
        ? prev.filter((id) => id !== platformId)
        : [...prev, platformId]
    );
  }, []);

  const handleBatchExport = useCallback(async () => {
    if (!masterRecording || batchPlatforms.length === 0 || !onStartBatchExport) return;
    if (!canBatch) {
      onDownloadLimitReached();
      return;
    }

    setIsExporting(true);
    setStep('encoding');
    setExportProgress(0);

    const srcW = masterRecording.sourceWidth || 1920;
    const srcH = masterRecording.sourceHeight || 1080;
    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    const configs = batchPlatforms.map((pid) => {
      return onSelectPlatform(pid, srcW, srcH, entitlements.maxResolution);
    });

    setBatchProgress({ current: 0, total: configs.length });

    try {
      const results = await onStartBatchExport(masterRecording, configs, (batchIndex, progress) => {
        setBatchProgress({ current: batchIndex + 1, total: configs.length });
        setExportProgress(progress);
      }, entitlements.watermarkRequired);
      const lastResult = results[results.length - 1];
      setExportResult(lastResult);
      setBatchProgress(null);

      if (lastResult.status === 'done') {
        setStep('done');
      } else {
        setStep('platform');
        showToast('Some exports failed. Check the results.');
      }
    } catch (err) {
      setStep('platform');
      showToast(err instanceof Error ? err.message : 'Batch export failed.');
    } finally {
      setIsExporting(false);
      setBatchProgress(null);
      setExportProgress(0);
    }
  }, [masterRecording, batchPlatforms, onStartBatchExport, onSelectPlatform, showToast, canBatch, onDownloadLimitReached, userPlan]);

  const handleExport = useCallback(async () => {
    if (!masterRecording || !exportConfig) return;

    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    if (!entitlements.canExport) {
      onDownloadLimitReached();
      return;
    }

    setIsExporting(true);
    setStep('encoding');
    setExportProgress(0);

    try {
      const result = await onStartExport(masterRecording, (progress) => {
        setExportProgress(progress);
      }, entitlements.watermarkRequired);
      setExportResult(result);

      if (result.status === 'done') {
        setStep('done');
      } else {
        setStep('platform');
        showToast(result.error || 'Export failed. Please try again.');
      }
    } catch (err) {
      setStep('platform');
      showToast(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [masterRecording, exportConfig, onStartExport, showToast]);

  const handleDownload = useCallback(async () => {
    const filename = generateFilename('video', 'mp4');

    // Check download entitlement
    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    if (!entitlements.canDownload) {
      onDownloadLimitReached();
      return;
    }

    // Direct download from blob (works without R2)
    if (exportResult?.resultBlob) {
      const url = URL.createObjectURL(exportResult.resultBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Downloaded: ${filename}`);
      return;
    }

    // Server download via R2 (requires auth + R2)
    if (!exportResult?.exportId) return;

    if (!isAuthenticated) {
      setPendingDownload(() => doDownload());
      onAuthRequired();
      return;
    }

    if (!canDownloadFile) {
      onDownloadLimitReached();
      return;
    }

    await doDownload();

    async function doDownload() {
      if (!exportResult?.exportId) return;

      try {
        const response = await fetch(`/api/download?exportId=${encodeURIComponent(exportResult.exportId)}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Download failed' }));
          showToast(errorData.error || 'Download failed. Please try again.');
          return;
        }
        const { url } = await response.json();
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`Downloaded: ${filename}`);
      } catch {
        showToast('Download failed. Please try again.');
      }
    }
  }, [exportResult, isAuthenticated, userPlan, canDownloadFile, onAuthRequired, onDownloadLimitReached, showToast]);

  const handleBack = useCallback(() => {
    if (step === 'crop') {
      setStep('platform');
    }
    if (step === 'done') {
      setStep('platform');
      setExportResult(null);
    }
    setExportProgress(0);
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
              {step === 'platform' && 'Choose a platform'}
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
              {isAuthenticated && userPlan === 'free' && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20">
                  <svg className="w-5 h-5 text-warning shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[12px] font-medium text-warning">Free Plan — Export Not Available</span>
                    <span className="text-[12px] text-text-secondary">Upgrade to Creator to export and download videos.</span>
                  </div>
                  <Button variant="primary" size="sm" onClick={onDownloadLimitReached} className="shrink-0 ml-auto">
                    Upgrade
                  </Button>
                </div>
              )}

              <VideoPlayer
                videoUrl={masterRecording.url}
                recordedDuration={masterRecording.duration}
                onError={() => {}}
                aspectRatio="16:9"
                isPreview={isPreview}
              />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PLATFORM_PRESETS.filter((p) => p.id !== 'custom').map((preset) => {
                  const isSelected = batchPlatforms.includes(preset.id);
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleSelectPlatform(preset.id)}
                      className={`group relative flex items-center gap-2.5 p-3 rounded-lg border transition-all duration-150 text-left min-h-[48px] ${
                        isSelected
                          ? 'shadow-sm ring-1'
                          : 'bg-elevated border-border-subtle hover:border-border-strong hover:bg-elevated'
                      }`}
                      style={isSelected ? {
                        borderColor: `${preset.color}66`,
                        backgroundColor: `${preset.color}1a`,
                        boxShadow: `0 0 0 1px ${preset.color}33`,
                      } : undefined}
                    >
                      {isSelected && (
                        <div
                          className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: preset.color }}
                        >
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                      <div
                        className={`flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-[10px] font-bold tracking-tight transition-all duration-150 ${
                          isSelected ? 'text-white shadow-sm' : 'text-text-secondary'
                        }`}
                        style={{ backgroundColor: isSelected ? preset.color : `${preset.color}33` }}
                      >
                        {preset.icon}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-[13px] font-medium leading-tight truncate ${
                          isSelected ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
                        }`}>
                          {preset.label}
                        </span>
                        <span className="text-[12px] text-text-secondary leading-tight truncate">
                          {preset.sublabel}
                        </span>
                      </div>
                    </button>
                  );
                })}
                <button
                  onClick={() => handleSelectPlatform('custom')}
                  className="group flex items-center gap-2.5 p-3 rounded-lg bg-elevated hover:bg-elevated border border-border-subtle hover:border-border-strong transition-all duration-150 text-left min-h-[48px]"
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-md bg-[#8B5CF6]/30 flex items-center justify-center text-[10px] font-bold tracking-tight text-text-secondary">
                    ⚙
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[13px] font-medium leading-tight text-text-secondary group-hover:text-text-primary">Custom</span>
                    <span className="text-[12px] text-text-secondary leading-tight">Define your own</span>
                  </div>
                </button>
              </div>

              {batchPlatforms.length > 0 && canBatch && (
                <div className="flex flex-col gap-2">
                  <p className="text-[12px] text-text-secondary">
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

              <div className="flex items-center gap-2 text-[12px] text-text-secondary">
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
                    className="w-full h-full"
                    style={{
                      objectFit: 'cover',
                      objectPosition: `${-(exportConfig.crop.x / (masterRecording.sourceWidth || 1920)) * 100}% ${-(exportConfig.crop.y / (masterRecording.sourceHeight || 1080)) * 100}%`,
                      transform: `scale(${exportConfig.crop.zoom})`,
                      transformOrigin: 'center center',
                    }}
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                </div>
              </div>

              {entitlementsView.canCrop ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const newX = exportConfig.crop.x - 50;
                      const maxX = (masterRecording.sourceWidth || 1920) - exportConfig.crop.width;
                      onUpdateCrop({ x: Math.max(0, Math.min(newX, maxX)) });
                    }}
                  >
                    ←
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const srcW = masterRecording.sourceWidth || 1920;
                      const srcH = masterRecording.sourceHeight || 1080;
                      const centerX = (srcW - exportConfig.crop.width) / 2;
                      const centerY = (srcH - exportConfig.crop.height) / 2;
                      onUpdateCrop({ x: Math.round(centerX), y: Math.round(centerY) });
                    }}
                  >
                    Center
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const newX = exportConfig.crop.x + 50;
                      const maxX = (masterRecording.sourceWidth || 1920) - exportConfig.crop.width;
                      onUpdateCrop({ x: Math.max(0, Math.min(newX, maxX)) });
                    }}
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
                    <span className="text-[12px] text-text-secondary">Zoom</span>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-elevated border border-border-subtle text-center">
                  <p className="text-[12px] text-text-secondary">Crop & reframe requires Creator</p>
                  <Button variant="primary" size="sm" onClick={onDownloadLimitReached} className="mt-2">
                    Upgrade to Creator
                  </Button>
                </div>
              )}

              <div className="text-center text-xs text-text-secondary">
                {exportConfig.aspectRatio} · {exportConfig.outputWidth}×{exportConfig.outputHeight}
              </div>

              <div className="flex flex-col gap-2">
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
              <div className="w-full bg-surface-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.round(exportProgress * 100)}%` }}
                />
              </div>
              <p className="text-sm text-text-secondary">
                {exportProgress < 0.05 ? 'Initializing encoder...' :
                 exportProgress < 0.15 ? 'Loading video frames...' :
                 exportProgress < 0.5 ? 'Encoding video frames...' :
                 exportProgress < 0.8 ? 'Encoding audio track...' :
                 exportProgress < 0.95 ? 'Muxing final file...' :
                 'Finalizing export...'}
              </p>
              <p className="text-xs text-text-secondary">
                {Math.round(exportProgress * 100)}% complete
              </p>
              {batchProgress && (
                <p className="text-xs text-text-secondary">
                  {batchProgress.current} of {batchProgress.total} exports complete
                </p>
              )}
              {onCancelExport && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    if (!window.confirm('Cancel export? Progress will be lost.')) return;
                    onCancelExport();
                    setStep('platform');
                    setIsExporting(false);
                    setBatchProgress(null);
                    setExportProgress(0);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}

          {step === 'done' && exportResult && (
            <>
              {exportResult.previewUrl && (
                <VideoPlayer
                  videoUrl={exportResult.previewUrl}
                  recordedDuration={masterRecording.duration}
                  onError={() => {}}
                  aspectRatio={exportResult.config?.aspectRatio || exportConfig?.aspectRatio || '16:9'}
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
                    setExportProgress(0);
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

          <div>
            <DiscordFeedback onSuccess={showToast} />
          </div>
        </div>
      </div>
    </div>
  );
}
