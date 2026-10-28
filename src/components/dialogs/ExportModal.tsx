'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Progress } from '@/components/ui/Progress';
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
  /**
   * True when this session's take is the thing Record Again discards (and
   * deletes). A library original is only detached, so that path must not warn
   * about a deletion that will not happen.
   */
  practiceAgainDiscardsTake?: boolean;
  onOpenLibrary?: () => void;
  onShare: () => void;
  showToast: (message: string) => void;
  isAuthenticated: boolean;
  userPlan: string;
  onAuthRequired: () => void;
  onDownloadLimitReached: () => void;
  exportConfig: ExportConfig | null;
  onSelectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }) => ExportConfig;
  /** Reveal the surface that owns the format switch (the review screen) before
      "Change format" closes the sheet — it may be hidden behind the Library. */
  onChangeFormat?: () => void;
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

/**
 * A failed export surfaces whatever the encoder or the server threw, which is
 * frequently a raw technical string (a Prisma message, a DOMException, a stack
 * line). None of that helps the person who just wants their video, so anything
 * that looks technical is replaced with a plain sentence; anything already
 * written for a human (short, sentence-like) is passed through untouched.
 */
export function humanizeExportError(message: string): string {
  const technical = /exception|prisma|undefined|cannot read|null|stack|at \w+\.|\/[a-z]+\/|::|error:|\b\d{3,}\b/i;
  const looksTechnical = technical.test(message) || message.length > 120;
  return looksTechnical
    ? 'Export failed. Please try again, or pick a different format.'
    : message;
}

export function ExportModal({
  isVisible,
  masterRecording,
  onClose,
  onPracticeAgain,
  practiceAgainDiscardsTake = true,
  onOpenLibrary,
  onShare,
  showToast,
  isAuthenticated,
  userPlan,
  onAuthRequired,
  onDownloadLimitReached,
  exportConfig,
  onSelectPlatform,
  onChangeFormat,
  initialPlatformId,
  onStartExport,
  onCancelExport,
}: ExportModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isVisible, onClose);
  const [step, setStep] = useState<ExportStep>('platform');
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportJob | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  // Guards the Download button against double-fire. A second click while the
  // first is still resolving started a duplicate download (and, on the server
  // path, a second signed-URL fetch) with no visible difference to the user.
  const [isDownloading, setIsDownloading] = useState(false);
  // Free users have no crop decision (their only output is YouTube 16:9) — set when
  // the platform step should skip "Adjust your crop" and jump straight to encoding.
  const [pendingAutoExport, setPendingAutoExport] = useState(false);
  // Both actions below throw work away, so they confirm first through the same
  // shared dialog the rest of the Studio uses (no native window.confirm).
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmPracticeOpen, setConfirmPracticeOpen] = useState(false);

  // Modal lifecycle: whenever the drawer closes, return to the first step and drop the
  // previous job's results. Otherwise the next take would reopen on a stale "Export complete"
  // screen showing the last export's (possibly revoked) preview URL.
  useEffect(() => {
    if (!isVisible) {
      setStep('platform');
      setExportResult(null);
      setIsExporting(false);
      setExportProgress(0);
      setPendingAutoExport(false);
      setConfirmCancelOpen(false);
      setConfirmPracticeOpen(false);
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
        showToast(result.error ? humanizeExportError(result.error) : 'Export failed. Please try again.');
      }
    } catch (err) {
      setStep('platform');
      // Only a plain message is ever considered for display; anything with a
      // stack or a technical shape is replaced by humanizeExportError below.
      const raw = err instanceof Error ? err.message : '';
      if (raw && isAuthFailureMessage(raw)) {
        showToast('Your session expired. Sign in again to export.');
        onAuthRequired();
        return;
      }
      showToast(raw ? humanizeExportError(raw) : 'Export failed. Please try again.');
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
    // Already downloading: a second click would start a duplicate fetch and a
    // second save dialog with no visible way to tell them apart.
    if (isDownloading) return;
    const filename = generateFilename('video', 'mp4');
    setIsDownloading(true);
    try {
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
    } finally {
      setIsDownloading(false);
    }

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
  }, [exportResult, isAuthenticated, userPlan, canDownloadFile, isDownloading, onAuthRequired, onDownloadLimitReached, showToast]);

  const handleBack = useCallback(() => {
    if (step === 'done') {
      setStep('platform');
      setExportResult(null);
    }
    setExportProgress(0);
  }, [step]);

  // The dialog panel — the boundary for the Tab trap and initial focus below.
  const panelRef = useRef<HTMLDivElement>(null);
  // The control that opened this dialog, so closing hands focus back to it.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Set when "Change format" closes the sheet: focus should land on the format
  // chip, not on the trigger, because that is the thing the user asked for.
  const changeFormatTargetRef = useRef<HTMLElement | null>(null);
  const hasMaster = !!masterRecording;

  // Remember the trigger while the sheet is still closed. Snapshotting
  // activeElement on open no longer works: opening the sheet also makes the
  // studio shell inert, and a focused element inside a subtree that becomes
  // inert is blurred to <body> before effects run. The trigger's pointerdown /
  // focusin fires before `shouldRender` flips, so these listeners catch it.
  const shouldRenderRef = useRef(shouldRender);
  shouldRenderRef.current = shouldRender;
  useEffect(() => {
    const remember = (target: EventTarget | null) => {
      if (shouldRenderRef.current) return;
      if (!(target instanceof HTMLElement)) return;
      if (target === document.body || target === document.documentElement) return;
      // A pointerdown usually lands on the icon/text span inside the trigger,
      // not the button itself. Remembering that span would make the restore
      // focus() a no-op and strand focus on <body> — resolve the control.
      const control = target.closest<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      returnFocusRef.current = control ?? target;
    };
    const onFocusIn = (e: FocusEvent) => remember(e.target);
    const onPointerDown = (e: PointerEvent) => remember(e.target);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  // Hand focus back once the sheet is gone, but only if it would otherwise be
  // lost, so we never steal focus from a dialog that opened on top.
  useEffect(() => {
    if (shouldRender) return;
    const chip = changeFormatTargetRef.current;
    changeFormatTargetRef.current = null;
    const trigger = returnFocusRef.current;
    returnFocusRef.current = null;
    // The chip is the better destination for "Change format", but the review
    // tray is display:none while the Library panel is the visible one (the
    // studio panel stays mounted). Focusing a hidden element silently drops
    // focus to <body>, so fall back to the trigger in that case.
    const target =
      chip && chip.isConnected && chip.offsetParent !== null ? chip : trigger;
    const active = document.activeElement;
    const focusIsLost =
      active === null ||
      active === document.body ||
      active === document.documentElement ||
      !active.isConnected;
    if (target && target.isConnected && target.offsetParent !== null && focusIsLost) {
      target.focus();
    }
  }, [shouldRender]);

  // "Change format" is a navigation, not a dismissal: the only place a format
  // is chosen is the review screen's "Preview as" switcher (this step confirms
  // the target, which is why it no longer claims to be a chooser).
  const handleChangeFormat = useCallback(() => {
    onChangeFormat?.();
    changeFormatTargetRef.current = document.querySelector<HTMLElement>(
      '[data-review-tray] [data-platform-switcher] [aria-pressed="true"]'
    );
    closeModal();
  }, [closeModal, onChangeFormat]);

  // Focus into the dialog on open. The sheet used to leave focus on the
  // trigger behind it, so the first Tab was the only way in and Enter could
  // re-fire the background control. Same contract as the shared Modal and
  // PricingModal: an explicit [data-modal-initial-focus] marker, else the
  // first control that is not the header Close. `step` and `hasMaster` are
  // dependencies because each step is a new task and the loading skeleton is
  // replaced by real content when a restored take finishes reading back.
  useEffect(() => {
    if (!shouldRender) return;
    const root = panelRef.current;
    if (!root) return;
    const explicit = root.querySelector<HTMLElement>('[data-modal-initial-focus]');
    if (explicit && !explicit.hasAttribute('disabled')) {
      explicit.focus();
      return;
    }
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const firstTaskControl =
      focusable.find((el) => el.getAttribute('aria-label') !== 'Close') ?? focusable[0];
    firstTaskControl.focus();
  }, [shouldRender, step, hasMaster]);

  // Escape dismisses; Tab is kept inside the sheet so keyboard focus cannot
  // fall out onto the page behind a dialog that is modal in every other
  // respect. The skeleton panel takes the same ref, so the trap is active
  // before the take is readable too.
  useEffect(() => {
    if (!shouldRender) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // A confirmation raised from inside this sheet owns both keys while it is
      // open; otherwise one Escape would dismiss the sheet behind it and one
      // Tab would pull focus out of the alertdialog.
      if (confirmCancelOpen || confirmPracticeOpen) return;
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = panelRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shouldRender, closeModal, confirmCancelOpen, confirmPracticeOpen]);

  if (!shouldRender) return null;

  // The sheet's whole body depends on the take. Rather than rendering nothing
  // (or a blank box) while the master blob is still being read back out of
  // IndexedDB after a reload, show a skeleton shaped like the platform step so
  // the dialog opens immediately and content swaps in without a height jump.
  if (!masterRecording) {
    return (
      <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Export recording" {...swipeHandlers}>
        <div
          className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
          onClick={closeModal}
        />
        <div ref={panelRef} className={`relative w-full max-w-lg bg-surface border border-border-default rounded-xl shadow-2xl overflow-hidden ${isClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
          <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border-subtle">
            <h2 className="text-sm font-semibold text-text-primary">Ready to export</h2>
            <button
              onClick={closeModal}
              className="p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
          <div role="status" aria-label="Loading your video" className="p-4 sm:p-5 flex flex-col gap-4">
            <div className="w-full aspect-video rounded-lg bg-elevated animate-pulse" />
            <div className="flex items-center gap-3 p-3 rounded-lg bg-elevated border border-border-subtle">
              <div className="w-10 h-10 rounded-md bg-border-default animate-pulse" />
              <div className="flex flex-col gap-1.5 flex-1">
                <div className="h-3 w-24 rounded bg-border-default animate-pulse" />
                <div className="h-2.5 w-32 rounded bg-border-default animate-pulse" />
              </div>
            </div>
            <div className="h-11 w-full rounded-lg bg-elevated animate-pulse" />
            <p className="sr-only">Loading your video for export.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Export recording" {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={closeModal}
      />

      <div ref={panelRef} className={`relative w-full max-w-lg bg-surface border border-border-default rounded-xl shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden max-h-[90vh] overflow-y-auto`}>
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
              {step === 'platform' && 'Ready to export'}
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
                    <span className="text-[12px] font-medium text-text-primary">Free Plan — YouTube 16:9 included, unlimited local downloads</span>
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
                    onClick={handleChangeFormat}
                  >
                    Change format
                  </Button>
                </div>
              )}

              {exportConfig && (
                <Button
                  variant="primary"
                  size="lg"
                  data-modal-initial-focus
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
              {/* Shared Progress component: it carries role="progressbar" with
                  aria-valuenow/min/max, so assistive tech can read how far along
                  the export is. The status text below is the live region — the
                  percentage alone is not a useful announcement. */}
              <Progress value={exportProgress * 100} size="md" className="w-full" />
              <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col items-center gap-1 text-center">
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
              </div>
              {onCancelExport && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setConfirmCancelOpen(true)}
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
                  data-modal-initial-focus
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
                  onClick={() => {
                    if (practiceAgainDiscardsTake) {
                      setConfirmPracticeOpen(true);
                      return;
                    }
                    // A library original is only detached; nothing is destroyed.
                    onPracticeAgain();
                  }}
                  className="w-full"
                >
                  Record Again
                </Button>
              </div>
            </>
          )}

          {/* UX-004: community/feedback lives on the export-success step only —
              never under the primary Export CTA in the task dialog. */}
          {step === 'done' && (
            <div>
              <DiscordFeedback onSuccess={showToast} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmCancelOpen}
        title="Cancel export?"
        message="The export progress so far will be lost. Your recording stays in the library."
        confirmLabel="Cancel export"
        cancelLabel="Keep exporting"
        onConfirm={() => {
          setConfirmCancelOpen(false);
          onCancelExport?.();
          setStep('platform');
          setIsExporting(false);
          setExportProgress(0);
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      <ConfirmDialog
        isOpen={confirmPracticeOpen}
        title="Record again?"
        message="Record Again discards this take and deletes it from your library. This cannot be undone."
        confirmLabel="Record again"
        onConfirm={() => {
          setConfirmPracticeOpen(false);
          onPracticeAgain();
        }}
        onCancel={() => setConfirmPracticeOpen(false)}
      />
    </div>
  );
}
