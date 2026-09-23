'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, CloseIcon, ShareIcon, ArrowLeftIcon } from '@/components/icons';
import { DiscordFeedback } from './DiscordFeedback';
import { VideoPlayer } from '@/components/studio/VideoPlayer';
import { generateFilename } from '@/services/download.service';
import { setPendingDownload } from '@/lib/auth-guard';
import { getEntitlements, isCreatorPlan, isPlatformLockedForUser } from '@/lib/entitlements';
import type { ExportStep, PlatformId, ExportConfig, MasterRecording, ExportJob } from '@/types';
import { PLATFORM_PRESETS } from '@/constants';
import { formatTime } from '@/utils/format';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface ExportModalProps {
  isVisible: boolean;
  masterRecording: MasterRecording | null;
  onClose: () => void;
  onPracticeAgain: () => void;
  onOpenLibrary?: () => void;
  onShare: () => void;
  showToast: (message: string) => void;
  isAuthenticated: boolean;
  userPlan: string;
  onAuthRequired: () => void;
  onDownloadLimitReached: () => void;
  onUpgradeRequired?: (platformId: PlatformId) => void;
  exportConfig: ExportConfig | null;
  onSelectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }) => ExportConfig;
  onUpdateCrop: (updates: { x?: number; y?: number; zoom?: number }) => void;
  onStartExport: (master: MasterRecording, onProgress?: (progress: number) => void, watermarkRequired?: boolean) => Promise<ExportJob>;
  onStartBatchExport?: (master: MasterRecording, configs: ExportConfig[], onProgress?: (batchIndex: number, progress: number) => void, watermarkRequired?: boolean) => Promise<ExportJob[]>;
  onCancelExport?: () => void;
}

// Matches server auth failures (expired/revoked session, rowless identity)
// so the modal can route them to sign-in instead of a dead-end toast.
export function isAuthFailureMessage(message: string): boolean {
  return /unauthorized|user not found|session expired|sign in/i.test(message);
}

export function ExportModal({
  isVisible,
  masterRecording,
  onClose,
  onPracticeAgain,
  onOpenLibrary,
  onShare,
  showToast,
  isAuthenticated,
  userPlan,
  onAuthRequired,
  onDownloadLimitReached,
  onUpgradeRequired,
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
  // Free users have no crop decision (their only output is YouTube 16:9) — set when
  // the platform step should skip "Adjust your crop" and jump straight to encoding.
  const [pendingAutoExport, setPendingAutoExport] = useState(false);

  // Modal lifecycle: whenever the drawer closes, return to the first step and drop the
  // previous job's results. Otherwise the next take would reopen on a stale "Export complete"
  // screen showing the last export's (possibly revoked) preview URL.
  useEffect(() => {
    if (!isVisible) {
      setStep('platform');
      setExportResult(null);
      setIsExporting(false);
      setExportProgress(0);
      setBatchProgress(null);
      setBatchPlatforms([]);
      setPendingAutoExport(false);
    }
  }, [isVisible]);

  const isGuest = !isAuthenticated;
  const entitlementsView = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
  // Free plan has unlimited local downloads — mirror entitlements instead of an old hardcoded reject.
  const canDownloadFile = isAuthenticated && entitlementsView.canDownload;
  const canBatch = entitlementsView.canBatchExport;

  // Free plan: only YouTube 16:9 is included. All other formats are Creator-locked.
  const isCreatorUser = isCreatorPlan(userPlan);
  const isLockedPlatform = (platformId: PlatformId) => isPlatformLockedForUser(platformId, userPlan);

  const handleSelectPlatform = useCallback((platformId: PlatformId) => {
    if (isGuest) {
      // Guest: only YouTube 16:9 (free format) is available without auth.
      // All other platforms require login + Creator plan.
      if (platformId !== 'youtube-landscape') {
        onAuthRequired();
        return;
      }
    }
    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    if (!entitlements.canExport) {
      onDownloadLimitReached();
      return;
    }
    if (!isGuest && isLockedPlatform(platformId)) {
      // Locked format for Free → open contextual upgrade, never start an export
      onUpgradeRequired?.(platformId) ?? onDownloadLimitReached();
      return;
    }
    const srcW = masterRecording?.sourceWidth || 1920;
    const srcH = masterRecording?.sourceHeight || 1080;
    onSelectPlatform(platformId, srcW, srcH, entitlements.maxResolution);
    // Crop/reframe controls are not part of the launch scope.
    // Skip directly to encoding for all users.
    setPendingAutoExport(true);
    setStep('encoding');
  }, [isGuest, onSelectPlatform, masterRecording, userPlan, onAuthRequired, onDownloadLimitReached, isLockedPlatform, onUpgradeRequired]);

  // YouTube 16:9 is the default/free format — preselect it so Free users never
  // have to pick a platform before a basic export. Runs on open and after login.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!isVisible) {
      autoSelectedRef.current = false;
      return;
    }
    if (!masterRecording || exportConfig || autoSelectedRef.current) return;
    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    if (!entitlements.canExport) return;
    autoSelectedRef.current = true;
    onSelectPlatform(
      'youtube-landscape',
      masterRecording.sourceWidth || 1920,
      masterRecording.sourceHeight || 1080,
      entitlements.maxResolution,
    );
  }, [isVisible, masterRecording, exportConfig, isGuest, userPlan, onSelectPlatform]);

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
      const message = err instanceof Error ? err.message : 'Export failed. Please try again.';
      if (isAuthFailureMessage(message)) {
        showToast('Your session expired. Sign in again to export.');
        onAuthRequired();
        return;
      }
      showToast(message);
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
    if (!isGuest && isLockedPlatform(exportConfig.platformId)) {
      // Stale config (e.g. plan changed) — never export a locked format for Free
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
      const message = err instanceof Error ? err.message : 'Export failed. Please try again.';
      if (isAuthFailureMessage(message)) {
        showToast('Your session expired. Sign in again to export.');
        onAuthRequired();
        return;
      }
      showToast(message);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [masterRecording, exportConfig, onStartExport, showToast, isGuest, isLockedPlatform, onDownloadLimitReached, userPlan]);

  // Free users skip the crop step entirely: the platform step flags a pending export and,
  // once a fresh config exists (auto-selected YouTube 16:9), encoding starts immediately.
  useEffect(() => {
    if (!pendingAutoExport || !exportConfig) return;
    setPendingAutoExport(false);
    void handleExport();
  }, [pendingAutoExport, exportConfig, handleExport]);

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
      // Defer revoke until the browser has started fetching the blob —
      // synchronous revoke can abort the download and orphan in-flight blob GETs.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
          if (response.status === 401) {
            showToast('Your session expired. Sign in again to download.');
            onAuthRequired();
            return;
          }
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
              {step === 'encoding' && 'Exporting...'}
              {step === 'done' && 'Video exported'}
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
              {isGuest && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-elevated border border-border-subtle">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[12px] font-medium text-text-primary">Export as guest — YouTube 16:9 included</span>
                    <span className="text-[12px] text-text-secondary">Sign in for all formats, higher quality, and cloud library.</span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={onAuthRequired} className="shrink-0 ml-auto">
                    Sign in
                  </Button>
                </div>
              )}
              {isAuthenticated && !isCreatorUser && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-elevated border border-border-subtle">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[12px] font-medium text-text-primary">Free Plan — YouTube 16:9 included, unlimited downloads</span>
                    <span className="text-[12px] text-text-secondary">Other formats need Creator. Exports include a watermark.</span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={onDownloadLimitReached} className="shrink-0 ml-auto">
                    Upgrade
                  </Button>
                </div>
              )}

              <VideoPlayer
                videoUrl={masterRecording.url}
                recordedDuration={masterRecording.duration}
                onError={() => {}}
                aspectRatio={exportConfig ? (PLATFORM_PRESETS.find((p) => p.id === exportConfig.platformId)?.aspectRatio ?? '16:9') : '16:9'}
              />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PLATFORM_PRESETS.filter((p) => p.id !== 'custom').map((preset) => {
                  const isCurrentSelection = exportConfig?.platformId === preset.id;
                  const isLocked = isGuest ? preset.id !== 'youtube-landscape' : isLockedPlatform(preset.id);
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleSelectPlatform(preset.id)}
                      className={`group relative flex items-center gap-2.5 p-3 rounded-lg border transition-all duration-150 text-left min-h-[48px] ${
                        isCurrentSelection
                          ? 'shadow-sm ring-1'
                          : 'bg-elevated border-border-subtle hover:border-border-strong hover:bg-elevated'
                      }`}
                      style={isCurrentSelection ? {
                        borderColor: `${preset.color}66`,
                        backgroundColor: `${preset.color}1a`,
                        boxShadow: `0 0 0 1px ${preset.color}33`,
                      } : undefined}
                    >
                      {isCurrentSelection && (
                        <div
                          className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: preset.color }}
                        >
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                      {isLocked && (
                        <div
                          className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-overlay text-text-muted text-[9px] font-bold tracking-wide flex items-center gap-1"
                          title={isGuest ? 'Sign in required' : 'Creator plan required'}
                        >
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          {isGuest ? 'SIGN IN' : 'CREATOR'}
                        </div>
                      )}
                      <div
                        className={`flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-[10px] font-bold tracking-tight transition-all duration-150 ${
                          isCurrentSelection ? 'text-white shadow-sm' : 'text-text-secondary'
                        }`}
                        style={{ backgroundColor: isCurrentSelection ? preset.color : `${preset.color}33` }}
                      >
                        {preset.icon}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-[13px] font-medium leading-tight truncate ${
                          isCurrentSelection ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
                        }`}>
                          {preset.label}
                        </span>
                        <span className="text-[12px] text-text-secondary leading-tight truncate">
                          {isLocked ? (isGuest ? `${preset.sublabel} · Sign in` : `${preset.sublabel} · Creator`) : preset.sublabel}
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
                    <span className="text-[12px] text-text-secondary leading-tight">Define your own{!isGuest && !isCreatorUser ? ' · Creator' : ''}</span>
                  </div>
                  {!isGuest && !isCreatorUser && (
                    <div className="px-1.5 py-0.5 rounded bg-accent/20 text-accent text-[9px] font-bold tracking-wide">
                      👑 CREATOR
                    </div>
                  )}
                </button>
              </div>

              {exportConfig && (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    if (!isGuest && isLockedPlatform(exportConfig.platformId)) {
                      onDownloadLimitReached();
                      return;
                    }
                    if (entitlementsView.canExport) {
                      setPendingAutoExport(true);
                      setStep('encoding');
                    } else {
                      onDownloadLimitReached();
                    }
                  }}
                  className="w-full gap-2"
                  disabled={isExporting}
                >
                  <DownloadIcon className="w-4 h-4" />
                  Continue with {PLATFORM_PRESETS.find((p) => p.id === exportConfig.platformId)?.label || 'YouTube'}{' '}
                  {PLATFORM_PRESETS.find((p) => p.id === exportConfig.platformId)?.aspectRatio || '16:9'}
                </Button>
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

                {onOpenLibrary && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={onOpenLibrary}
                    className="w-full"
                  >
                    Open My Library
                  </Button>
                )}

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
