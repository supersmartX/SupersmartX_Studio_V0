'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, CloseIcon, ShareIcon, ArrowLeftIcon } from '@/components/icons';
import { DiscordFeedback } from './DiscordFeedback';
import { VideoPlayer } from '@/components/studio/VideoPlayer';
import { generateFilename } from '@/services/download.service';
import { setPendingDownload, stashPendingDownloadExportId } from '@/lib/auth-guard';
import { getEntitlements, isCreatorPlan, isPlatformLockedForUser } from '@/lib/entitlements';
import type { ExportStep, PlatformId, ExportConfig, MasterRecording, ExportJob } from '@/types';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import { formatTime, platformDisplayName, formatQualityLabel } from '@/utils/format';
import { getPreviewCropGeometry } from '@/lib/composition';
import { resolveInitialExportPlatform } from '@/lib/export/export-config';
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
  exportConfig: ExportConfig | null;
  onSelectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }) => ExportConfig;
  /** Last previewed platform — retained when the modal opens so a header or
      repeat open doesn't reset to YouTube. Falls back to YouTube when unset
      or not available to the current user. */
  initialPlatformId?: PlatformId;
  onStartExport: (master: MasterRecording, onProgress?: (progress: number) => void, watermarkRequired?: boolean) => Promise<ExportJob>;
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
  exportConfig,
  onSelectPlatform,
  initialPlatformId,
  onStartExport,
  onCancelExport,
}: ExportModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isVisible, onClose);
  const [step, setStep] = useState<ExportStep>('platform');
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
      setPendingAutoExport(false);
    }
  }, [isVisible]);

  const isGuest = !isAuthenticated;
  const entitlementsView = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
  // Free plan has unlimited local downloads — mirror entitlements instead of an old hardcoded reject.
  const canDownloadFile = isAuthenticated && entitlementsView.canDownload;

  // Free plan: only YouTube 16:9 is included. All other formats are Creator-locked.
  const isCreatorUser = isCreatorPlan(userPlan);
  const isLockedPlatform = (platformId: PlatformId) => isPlatformLockedForUser(platformId, userPlan);

  // YouTube 16:9 is the default/free format — preselect it so Free users never
  // have to pick a platform before a basic export. Runs on open and after login.
  // A retained preview choice (initialPlatformId) wins over the default so a
  // header/repeat open doesn't reset a deliberate Shorts/Reels/Square pick —
  // but only when that format is actually available to the current user.
  //
  // An existing exportConfig is NOT a reason to skip: reopening via the header
  // button (which never calls selectPlatform) would otherwise pin the sheet to
  // whatever was exported last. We instead remember which platform we resolved
  // to, so a genuine change re-selects once and a no-op re-render doesn't loop.
  const autoSelectedRef = useRef<PlatformId | null>(null);
  useEffect(() => {
    if (!isVisible) {
      autoSelectedRef.current = null;
      return;
    }
    if (!masterRecording) return;
    if (autoSelectedRef.current && exportConfig?.platformId === autoSelectedRef.current) return;
    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    if (!entitlements.canExport) return;
    const chosen = resolveInitialExportPlatform(
      initialPlatformId,
      (id) => isGuest || isPlatformLockedForUser(id, userPlan),
    );
    if (autoSelectedRef.current === chosen) return;
    autoSelectedRef.current = chosen;
    onSelectPlatform(
      chosen,
      masterRecording.sourceWidth || 1920,
      masterRecording.sourceHeight || 1080,
      entitlements.maxResolution,
    );
  }, [isVisible, masterRecording, exportConfig, isGuest, userPlan, initialPlatformId, onSelectPlatform]);

  const handleExport = useCallback(async () => {
    if (!masterRecording || !exportConfig) return;

    const entitlements = getEntitlements(userPlan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly');
    if (!entitlements.canExport) {
      onDownloadLimitReached();
      return;
    }
    if (isLockedPlatform(exportConfig.platformId)) {
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
      // OAuth reloads wipe the closure above — stash the intent so the
      // studio page can resume it after login.
      if (exportResult?.exportId) stashPendingDownloadExportId(exportResult.exportId);
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
                aspectRatio={exportConfig ? (LAUNCH_PLATFORM_PRESETS.find((p) => p.id === exportConfig.platformId)?.aspectRatio ?? '16:9') : '16:9'}
                videoStyle={
                  exportConfig
                    ? getPreviewCropGeometry(
                        masterRecording.sourceWidth || 1920,
                        masterRecording.sourceHeight || 1080,
                        exportConfig.outputWidth,
                        exportConfig.outputHeight,
                      ).style
                    : undefined
                }
              />

              {/* The platform is chosen once, in the Studio's "Preview as"
                  switcher. Repeating the grid here created two competing
                  sources of truth, so this step only confirms the choice. */}
              {exportConfig && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-elevated border border-border-subtle">
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: LAUNCH_PLATFORM_PRESETS.find((p) => p.id === exportConfig.platformId)?.color || '#666' }}
                  >
                    {LAUNCH_PLATFORM_PRESETS.find((p) => p.id === exportConfig.platformId)?.icon || 'YT'}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-text-primary truncate">
                      {platformDisplayName(exportConfig.platformId)}
                    </span>
                    <span className="text-[12px] text-text-secondary truncate">
                      {LAUNCH_PLATFORM_PRESETS.find((p) => p.id === exportConfig.platformId)?.aspectRatio} · {exportConfig.outputWidth} × {exportConfig.outputHeight}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={closeModal}
                    aria-label="Change format"
                  >
                    Change
                  </Button>
                </div>
              )}

              {exportConfig && (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    if (isLockedPlatform(exportConfig.platformId)) {
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
                  Export {platformDisplayName(exportConfig.platformId)} ·{' '}
                  {exportConfig.outputWidth}×{exportConfig.outputHeight}
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
              {/* Final composition, stated plainly: the file itself already
                  carries these exact dimensions — this caption names them so
                  the user knows what they are downloading. */}
              {(exportResult.config || exportConfig) && (
                <p className="text-[12px] text-text-secondary">
                  {platformDisplayName((exportResult.config || exportConfig)!.platformId)}
                  {' · '}{(exportResult.config || exportConfig)!.outputWidth} × {(exportResult.config || exportConfig)!.outputHeight}
                  {formatQualityLabel((exportResult.config || exportConfig)!.outputHeight)
                    ? ` · ${formatQualityLabel((exportResult.config || exportConfig)!.outputHeight)}`
                    : ''}
                </p>
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
