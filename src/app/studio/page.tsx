'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { NUDGE_AMOUNT_KEYBOARD, PLATFORM_PRESETS, DEFAULT_PLATFORM_ID } from '@/constants';

import { useWelcomeModal } from '@/hooks/useWelcomeModal';
import { useCamera } from '@/hooks/useCamera';
import { useRecorder } from '@/hooks/useRecorder';
import { useScriptStorage } from '@/hooks/useScriptStorage';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFocusView } from '@/hooks/useFocusView';
import { useToast } from '@/hooks/useToast';
import { useShare } from '@/hooks/useShare';
import { useMasterRecording } from '@/hooks/useMasterRecording';
import { useExportPipeline } from '@/hooks/useExportPipeline';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useMicMuteSync } from '@/hooks/useMicMuteSync';

import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useStudioCamera } from '@/hooks/useStudioCamera';
import { useRecordingTimer } from '@/hooks/useRecordingTimer';
import { useStudioUI } from '@/hooks/useStudioUI';
import { useHydrated } from '@/hooks/useHydrated';
import { getEntitlements, isCreatorPlan, isPlatformLockedForUser, FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';
import { getPreviewCropGeometry } from '@/lib/composition';
import { consumePendingDownloadExportId, hasPendingDownload } from '@/lib/auth-guard';
import { isReviewState, resolveStudioPhase } from '@/lib/review-state';
import { addDailyRecordingSeconds, canRecordToday, getDailyRecordingRemainingInFlight } from '@/lib/daily-recording';
import { getTeleprompterSessionCap, getTeleprompterRemainingInSession } from '@/lib/teleprompter-session';

import { Header } from '@/components/layout/Header';
import { IconRail } from '@/components/layout/IconRail';
import { BottomNav } from '@/components/layout/BottomNav';
import { InspectorPanel } from '@/components/layout/InspectorPanel';
import { Canvas } from '@/components/layout/Canvas';
import { DeviceSelectorBar } from '@/components/layout/DeviceSelectorBar';
import { TransportBar } from '@/components/layout/TransportBar';
import { Footer } from '@/components/layout/Footer';
import { CameraPreview } from '@/components/studio/CameraPreview';
import { EyeLineGuide } from '@/components/studio/EyeLineGuide';
import { TeleprompterOverlay } from '@/components/studio/TeleprompterOverlay';
import { RecordingBadge } from '@/components/studio/RecordingBadge';
import { Timer } from '@/components/studio/Timer';
import { CountdownOverlay } from '@/components/studio/CountdownOverlay';
import { InitOverlay } from '@/components/studio/InitOverlay';
import { FocalGuideway } from '@/components/studio/FocalGuideway';
import { WelcomeModal } from '@/components/dialogs/WelcomeModal';
import { ExportModal } from '@/components/dialogs/ExportModal';
import { PricingModal } from '@/components/dialogs/PricingModal';
import { UpgradePromptModal } from '@/components/dialogs/UpgradePromptModal';
import { ActivationModal } from '@/components/dialogs/ActivationModal';
import { AuthModal } from '@/components/auth/AuthModal';
import { PlatformPreviewSwitcher } from '@/components/studio/PlatformPreviewSwitcher';
import { RecordingsPanel } from '@/components/studio/LibraryPanel';
import { Toast } from '@/components/common/Toast';
import type { TabType, PlatformId, PlatformPreset } from '@/types';

export default function HomePage() {
  // Base hooks (called first, no ordering dependency)
  const welcomeModal = useWelcomeModal();
  const { toast, showToast, queueLength } = useToast();
  const { share } = useShare(showToast);
  const focusView = useFocusView();
  const scriptStorage = useScriptStorage();
  const hydrated = useHydrated();
  // `update` is intentionally not destructured here: the plan refresh on the
  // return trip belongs to ActivationModal, which is the single place that asks
  // the server what the order actually is.
  const { data: session, status: sessionStatus } = useSession();
  const userPlan = (session?.user?.plan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly') || 'free';
  const isCreatorUser = isCreatorPlan(userPlan);

  // Core infrastructure hooks
  const { settings, recordingConfig } = useStudioConfig();
  const camera = useCamera();
  const recorder = useRecorder(camera.stream, recordingConfig);

  // Camera management hook (needs settings + recorder state)
  const { handleCameraInitialize, handleVideoDeviceChange, handleAudioDeviceChange } = useStudioCamera({
    recordingState: recorder.recordingState,
    settings,
    camera,
  });

  const ui = useStudioUI();
  const {
    masterRecording: masterRecordingData,
    createMasterRecording,
    openStoredRecording,
    releaseMasterRecording,
    clearMasterRecording,
    restoreMasterRecording,
    isRestored,
    isLibraryOriginal,
  } = useMasterRecording();
  // Guard: completion effect must run once per recording blob.
  // `ui` is a new object every render, so including it in deps would
  // re-create the master recording (and revoke the preview URL) on every
  // re-render while state stays 'completed' — breaking preview + spamming
  // blob ERR_FILE_NOT_FOUND.
  const setDrawerVisible = ui.setIsDrawerVisible;
  const processedRecordingRef = useRef<Blob | null>(null);

  // The active creation phase drives progressive disclosure across the UI.
  // 'preparing' → script + teleprompter focused; 'recording' → camera only;
  // 'review' → the take exists, output/platform becomes relevant.
  //
  // Both the phase and the review flag are resolved in one place
  // (src/lib/review-state.ts) because the take can arrive two ways: finished
  // in this document, or restored from IndexedDB after a cross-document hop
  // (Google OAuth, the Cashfree redirect, the return trip, a reload). Every
  // review surface below routes through `isReview` — never through
  // `recorder.recordingState` directly, which is exactly what left a paid-for
  // take stranded after an upgrade.
  const reviewState = {
    recordingState: recorder.recordingState,
    isRestored,
    hasMasterRecording: !!masterRecordingData,
  };
  const isReview = isReviewState(reviewState);
  const inspectorContext = resolveStudioPhase(reviewState);

  const [pendingPricingAfterAuth, setPendingPricingAfterAuth] = useState(false);
  // Checkout intent from landing page (e.g. ?checkout=creator_monthly → open payment form directly)
  const [checkoutIntent, setCheckoutIntent] = useState<{ tier: 'creator'; billingPeriod: 'monthly' | 'yearly' } | null>(null);
  const [pricingInitialStep, setPricingInitialStep] = useState<'select' | 'form'>('select');

  const handlePricingClick = useCallback(() => {
    setPricingInitialStep('select');
    ui.setIsPricingModalOpen(true);
  }, [ui]);

  const handleUpgradeClick = useCallback(() => {
    setPricingInitialStep('select');
    ui.setIsPricingModalOpen(true);
  }, [ui]);

  const [lockedPlatform, setLockedPlatform] = useState<PlatformPreset | null>(null);

  // Payment success activation modal
  const [activationModal, setActivationModal] = useState<{ isOpen: boolean; plan: string; orderId: string | null }>({
    isOpen: false,
    plan: '',
    orderId: null,
  });

  // Detect ?payment=success query param after the Cashfree redirect.
  //
  // The param says "we came back", never "we paid". The configured return_url
  // is the same for a settled order and a declined one, so the outcome is
  // decided by ActivationModal asking the server, which asks Cashfree. This
  // effect only opens the modal and scrubs the URL; it deliberately does not
  // verify, so there is exactly one authority for what the order actually is.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      const plan = params.get('plan') || 'creator_monthly';
      const orderId = params.get('order_id');
      setActivationModal({ isOpen: true, plan, orderId });
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Contextual upgrade (S12): a Free user clicks a locked platform → show the
  // "Create for {platform}" prompt instead of a generic pricing modal.
  const handlePlatformUpgradeRequired = useCallback((platformId?: PlatformId) => {
    if (platformId) {
      const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
      if (preset) {
        setLockedPlatform(preset);
        // Persist intent so we can restore after payment redirect
        try { window.localStorage.setItem('sxs-upgrade-intent', platformId); } catch {}
        return;
      }
    }
    setPricingInitialStep('select');
    ui.setIsPricingModalOpen(true);
  }, [ui]);

  const handleUpgradeFromPrompt = useCallback(() => {
    setLockedPlatform(null);
    if (!session?.user) {
      // Guest: auth first, then pricing after login
      setPendingPricingAfterAuth(true);
      ui.setIsAuthModalOpen(true);
    } else {
      // Free logged-in user: go directly to pricing/checkout
      // Keep upgrade intent in localStorage for closed-loop restoration
      setPricingInitialStep('select');
      ui.setIsPricingModalOpen(true);
    }
  }, [session?.user, ui]);

  const handlePricingAuthRequired = useCallback(() => {
    setPendingPricingAfterAuth(true);
    ui.setIsPricingModalOpen(false);
    ui.setIsAuthModalOpen(true);
  }, [ui]);

  const handleAuthSuccessWithPricing = useCallback(() => {
    ui.handleAuthSuccess();
    if (pendingPricingAfterAuth) {
      setPendingPricingAfterAuth(false);
      // Reopen pricing after login so guest can continue checkout
      // Preserve checkout intent: go straight to payment form if it came from landing/studio CTA
      setPricingInitialStep(checkoutIntent ? 'form' : 'select');
      setTimeout(() => ui.setIsPricingModalOpen(true), 250);
      showToast('Logged in — continue to checkout');
    } else if (checkoutIntent && session?.user) {
      setPricingInitialStep('form');
      setTimeout(() => ui.setIsPricingModalOpen(true), 250);
    }
  }, [pendingPricingAfterAuth, checkoutIntent, session?.user, ui, showToast]);

  // Capture ?checkout=creator_monthly|creator_yearly (landing page) or localStorage pending plan,
  // then auto-open the payment form. Waits for session load so logged-in users
  // go straight to payment instead of a stray login prompt.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStatus === 'loading') return;
    let intent: { tier: 'creator'; billingPeriod: 'monthly' | 'yearly' } | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('checkout');
      if (q === 'creator_monthly') intent = { tier: 'creator', billingPeriod: 'monthly' };
      else if (q === 'creator_yearly') intent = { tier: 'creator', billingPeriod: 'yearly' };
      if (!intent) {
        const stored = window.localStorage.getItem('sxs-pending-plan');
        if (stored === 'creator_monthly') intent = { tier: 'creator', billingPeriod: 'monthly' };
        else if (stored === 'creator_yearly') intent = { tier: 'creator', billingPeriod: 'yearly' };
      }
    } catch {}
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (!intent) return;
    setCheckoutIntent(intent);
    setPricingInitialStep('form');
    try { window.localStorage.removeItem('sxs-pending-plan'); } catch {}
    if (session?.user) {
      const t = setTimeout(() => ui.setIsPricingModalOpen(true), 400);
      return () => clearTimeout(t);
    } else {
      setPendingPricingAfterAuth(true);
      const t = setTimeout(() => ui.setIsAuthModalOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [sessionStatus]);

  // After Google/GitHub auth redirect (page reload), restore the upgrade intent
  // so the user doesn't have to click the locked platform again.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStatus === 'loading' || !session?.user) return;
    try {
      const pendingPlatform = window.localStorage.getItem('sxs-upgrade-intent');
      if (pendingPlatform) {
        const preset = PLATFORM_PRESETS.find((p) => p.id === pendingPlatform);
        if (preset) {
          // User is now authenticated — show the upgrade prompt directly
          const t = setTimeout(() => setLockedPlatform(preset), 400);
          return () => clearTimeout(t);
        }
      }
    } catch {}
  }, [sessionStatus, session?.user]);

  // OAuth reload wipes the in-memory pending download. A sessionStorage
  // intent survives navigation: after login, guide the user to the library
  // where the authenticated download works. (Credentials logins keep the
  // live closure via handleAuthSuccess instead.)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStatus === 'loading' || !session?.user) return;
    const pendingExportId = consumePendingDownloadExportId();
    if (!pendingExportId) return;
    // Credentials logins keep the live closure, which downloads immediately —
    // don't also yank the user to the library.
    if (hasPendingDownload()) return;
    showToast('Signed in — your recording was kept. Download it from your library.');
    setActivePanel('library');
  }, [sessionStatus, session?.user, showToast]);
  const entitlements = getEntitlements((session?.user?.plan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly') || 'free');
  // Free: a single recording can never exceed the day's remaining budget
  // (e.g. 4 min used → next recording auto-stops at 6 min). Creator: null = unlimited.
  const recordingCap = isCreatorUser
    ? null
    : Math.max(1, Math.min(entitlements.maxDurationSeconds ?? 600, getDailyRecordingRemainingInFlight(0)));
  // Stopping a take releases the camera immediately (OS indicator off).
  // Review always plays the recorded Blob, never the live stream, and the
  // next Start re-acquires a clean stream (see handleRecordStart).
  const handleStopAndReleaseCamera = useCallback(() => {
    recorder.stopRecording();
    camera.stop();
  }, [recorder, camera]);

  const { elapsedSeconds, resetTimer } = useRecordingTimer({
    recordingState: recorder.recordingState,
    stopRecording: handleStopAndReleaseCamera,
    showToast,
    maxDurationSeconds: recordingCap,
    resetOnComplete: false,
  });  const isRecordingOrPaused = recorder.recordingState === 'recording' || recorder.recordingState === 'paused';
  // During SSR the server renders the full 10-min allowance (no localStorage access).
  // Before hydration completes, keep that same value to avoid a mismatch; once
  // hydrated, switch to the real localStorage-backed remaining budget.
  const dailyRemainingRaw = isCreatorUser
    ? null
    : getDailyRecordingRemainingInFlight(isRecordingOrPaused ? elapsedSeconds : 0);
  const dailyRemainingDisplay = isCreatorUser ? null : (hydrated ? dailyRemainingRaw : FREE_DAILY_RECORDING_SECONDS);

  // Free teleprompter: fresh 3 min allowance PER RECORDING SESSION (capped by the remaining
  // daily recording budget). It hides at the cap but the camera keeps recording, and it never
  // deducts from the 10 min/day recording budget.
  const prompterScript = scriptStorage.script.trim();
  const teleprompterActive = prompterScript.length > 0;
  const teleprompterActiveRef = useRef(teleprompterActive);
  useEffect(() => {
    teleprompterActiveRef.current = teleprompterActive;
  }, [teleprompterActive]);
  const teleprompterSessionCap = getTeleprompterSessionCap({ isCreator: isCreatorUser, recordingCapSeconds: recordingCap });
  const teleprompterRemaining = getTeleprompterRemainingInSession(
    teleprompterSessionCap,
    isRecordingOrPaused && teleprompterActive ? elapsedSeconds : 0,
  );
  const teleprompterDisabled = teleprompterRemaining !== null && teleprompterActive && teleprompterRemaining <= 0;
  const teleprompterRemainingDisplay = isCreatorUser ? null : teleprompterRemaining;
  const teleprompterNotice = isCreatorUser
    ? null
    : teleprompterDisabled
      ? `Teleprompter limit reached (3 min per recording on Free). Upgrade to Creator for unlimited.`
      : `Free plan: ${Math.max(1, Math.ceil((teleprompterRemainingDisplay ?? 0) / 60))} min teleprompter for this recording`;

  // Local UI state
  const isMobile = useMediaQuery('(max-width: 640px)');
  // The side rail + docked inspector need 1280px before they stop squeezing the
  // canvas, so everything below `xl` uses the bottom nav and a drawer inspector.
  // Kept in sync with the `xl` breakpoint used by IconRail/BottomNav/InspectorPanel.
  const isCompactLayout = useMediaQuery('(max-width: 1279px)');
  const [activePanel, setActivePanel] = useState<TabType | 'record' | 'share'>('studio');
  const [isMicMuted, setIsMicMuted] = useState(false);
  // The mute state is pushed onto whatever stream is live AT THE MOMENT of the
  // change — including a stream acquired after the toggle (Stop → Start, a
  // device switch), whose fresh tracks arrive enabled. Without this the button
  // reported "muted" while the recording captured live audio.
  useMicMuteSync(isMicMuted, camera.stream);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  // Preview as — separate from export platform. Declared up here because
  // "New Video" resets it as part of ending the creation session.
  const [previewPlatformId, setPreviewPlatformId] = useState<PlatformId>(DEFAULT_PLATFORM_ID);

  useEffect(() => {
    if (isCompactLayout) setIsInspectorOpen(false);
  }, [isCompactLayout]);
  const prompterContainerRef = useRef<HTMLDivElement>(null);

  const {
    exportConfig,
    exportJobs,
    setExportConfig,
    selectPlatform,
    startExport,
    cancelExport,
    clearJobs,
  } = useExportPipeline();

  // "New Video" — start a clean creation session.
  //
  // Two workflows exist and must not bleed into each other:
  //   A. create a NEW video  (here)
  //   B. work with an EXISTING library recording (openStoredRecording)
  //
  // This used to only switch the active panel, so the previous take, its review
  // state, its preview platform and its export config all survived the click and
  // the Studio reopened showing the recording the user had already finished.
  // It must not reuse clearMasterRecording: that deletes the IndexedDB row,
  // which is the only copy of the bytes, so the previous take has to be
  // DETACHED here and left in the library, reachable from Library only.
  const handleNewVideo = useCallback(() => {
    ui.setIsDrawerVisible(false);
    // 'completed' keeps review alive on its own (see isReviewState), so the
    // capture session has to go back to idle or review survives with no take.
    recorder.resetRecording();
    releaseMasterRecording();
    clearJobs();
    setExportConfig(null);
    setPreviewPlatformId(DEFAULT_PLATFORM_ID);
    setActivePanel('studio');
    // DC-1: a new video starts with an empty script. The outgoing take keeps
    // ITS script in its own row; the editor is a fresh draft area from here.
    scriptStorage.clearScript();
  }, [ui, recorder, releaseMasterRecording, clearJobs, setExportConfig, scriptStorage.clearScript]);

  // Restore the master recording from IndexedDB. This is the only thing that
  // carries a take across a cross-document navigation (Google OAuth, the
  // Cashfree redirect, the return trip, a reload), so it runs for every
  // session — the hook makes it one attempt per document and refuses to
  // resurrect a take the user explicitly discarded or left behind via New Video.
  useEffect(() => {
    if (!masterRecordingData) {
      restoreMasterRecording();
    }
  }, [masterRecordingData, restoreMasterRecording]);

  // DC-1 — the attached video's script SNAPSHOT is authoritative for that
  // video. Fires whenever a master attaches (fresh completion, library open,
  // cross-document restore): whatever the global editor held as a draft is
  // replaced by the take's own saved script. Editing the editor afterwards
  // only changes the draft — this effect does not re-run, and the row's
  // snapshot was written once at creation, so the saved copy never mutates.
  const applyMasterScriptSnapshot = scriptStorage.setScript;
  useEffect(() => {
    if (masterRecordingData && typeof masterRecordingData.script === 'string') {
      applyMasterScriptSnapshot(masterRecordingData.script);
    }
  }, [masterRecordingData, applyMasterScriptSnapshot]);

  // Handle recording completion → create master recording (once per blob)
  useEffect(() => {
    if (recorder.recordingState !== 'completed') return;
    const resultBlob = recorder.recordingResult?.blob;
    if (!resultBlob) return;
    // Already handled this exact blob — skip (prevents revoke/recreate loop)
    if (processedRecordingRef.current === resultBlob) return;
    processedRecordingRef.current = resultBlob;

    // Don't auto-open ExportModal — let user preview first via "Preview as"
    // setDrawerVisible(true);

      // Free: accumulate finished recording time toward the 10 min/day budget.
      // Downloads are unlimited and never consume recording time. The teleprompter has a
      // per-recording allowance and is never banked separately.
      // `result.duration` is ACTIVE capture time (paused seconds excluded),
      // so the budget is charged for what was actually recorded.
      if (!isCreatorUser && recorder.recordingResult?.duration) {
        addDailyRecordingSeconds(recorder.recordingResult.duration);
      }

      if (recorder.recordingResult?.blob) {
        // Extract actual video dimensions from the recorded blob
        // Camera track settings can differ from actual MediaRecorder output
        const result = recorder.recordingResult;
        // DC-1: the script as it stands at completion is this video's
        // snapshot. It rides along into the master + its stored row.
        const scriptSnapshot = scriptStorage.script;
        const videoEl = document.createElement('video');
        const blobUrl = URL.createObjectURL(result.blob);
        videoEl.preload = 'metadata';
        videoEl.src = blobUrl;

        const cleanupProbe = () => {
          videoEl.onloadedmetadata = null;
          videoEl.onerror = null;
          videoEl.removeAttribute('src');
          videoEl.load();
          URL.revokeObjectURL(blobUrl);
        };

        videoEl.onloadedmetadata = () => {
          const actualWidth = videoEl.videoWidth || recordingConfig.width;
          const actualHeight = videoEl.videoHeight || recordingConfig.height;
          // Authoritative media duration: what actually plays back. The
          // recorder's active-clock figure (also pause-aware) is the
          // fallback when the container reports a non-finite duration.
          const mediaDuration = Number.isFinite(videoEl.duration) && videoEl.duration > 0
            ? videoEl.duration
            : result.duration;
          cleanupProbe();
          createMasterRecording(
            result.blob,
            mediaDuration,
            result.hasAudio,
            actualWidth,
            actualHeight,
            scriptSnapshot
          );
        };

        videoEl.onerror = () => {
          cleanupProbe();
          // Fallback to config dimensions
          createMasterRecording(
            result.blob,
            result.duration,
            result.hasAudio,
            recordingConfig.width,
            recordingConfig.height,
            scriptSnapshot
          );
        };
      }

    resetTimer();
  }, [recorder.recordingState, recorder.recordingResult, createMasterRecording, recordingConfig.width, recordingConfig.height, isCreatorUser, setDrawerVisible, resetTimer, scriptStorage.script]);

  // Free: the teleprompter allowance runs per recording (3 min, capped by the recording
  // budget). When it runs out mid-take the prompter hides — but the CAMERA KEEPS RECORDING.
  const teleprompterWarnedRef = useRef(false);
  const teleprompterLimitNotifiedRef = useRef(false);
  useEffect(() => {
    if (isCreatorUser || recorder.recordingState !== 'recording') {
      teleprompterWarnedRef.current = false;
      teleprompterLimitNotifiedRef.current = false;
      return;
    }
    if (!teleprompterActiveRef.current || teleprompterSessionCap == null) return;
    const remaining = getTeleprompterRemainingInSession(teleprompterSessionCap, elapsedSeconds);
    if (remaining === null) return;
    if (remaining <= 0) {
      if (!teleprompterLimitNotifiedRef.current) {
        teleprompterLimitNotifiedRef.current = true;
        showToast('Teleprompter limit reached (3 min per recording on Free). Camera recording continues.');
      }
    } else if (remaining <= 60 && !teleprompterWarnedRef.current) {
      teleprompterWarnedRef.current = true;
      showToast('1 minute of teleprompter left (3 min per recording on Free)');
    }
  }, [elapsedSeconds, recorder, showToast, isCreatorUser, teleprompterSessionCap]);

  const handleRecordStart = useCallback(async () => {
    // Free: enforce 10 min TOTAL recording per day (downloads stay unlimited)
    if (!isCreatorUser && !canRecordToday()) {
      showToast('Your device-local Free recording allowance is used for today. It may reset if site data is cleared or you switch browser profiles.');
      ui.setIsPricingModalOpen(true);
      return;
    }

    // Camera released after a previous take (or never enabled): acquire a
    // clean stream first. Pre-permission users go through the Enable-camera
    // overlay instead of a silent no-op — except in review, which renders
    // over the Canvas children and would otherwise hide that overlay behind a
    // document that has no camera at all. After an upgrade return there is no
    // InitOverlay to click, so Start acquires on demand; it is a user gesture,
    // so the browser permission prompt is the expected affordance.
    let liveStream = camera.stream;
    if (!liveStream) {
      if (!camera.hasInitialized && !isReview) return;
      liveStream = await handleCameraInitialize();
      if (!liveStream) return;
    }

    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollTop = 0;
    }

    resetTimer();

    const scrollCallback = () => {
      if (!prompterContainerRef.current) return;
      const container = prompterContainerRef.current;
      const speed = settings.teleprompter.scrollSpeed;
      const multiplier = settings.teleprompter.scrollSpeedMultiplier;
      container.scrollTop += (speed / 20) * multiplier;
    };

    const checkEndCallback = (): boolean => {
      if (!prompterContainerRef.current) return false;
      const container = prompterContainerRef.current;
      const scrolledHeight = container.scrollTop + container.clientHeight;
      const scrollableHeight = container.scrollHeight;
      return scrolledHeight >= scrollableHeight - 5;
    };

    // FC-1.0 countdown + DC-2: the countdown setting decides whether capture
    // waits; the teleprompter's auto-stop is the only stop that announces
    // itself with a toast (an ordinary Stop never reaches this callback).
    recorder.startRecording(scrollCallback, checkEndCallback, liveStream, {
      countdown: settings.countdownEnabled,
      onScriptEnd: () => showToast('Script ended — recording stopped'),
    });
  }, [camera, recorder, settings.teleprompter.scrollSpeed, settings.teleprompter.scrollSpeedMultiplier, settings.countdownEnabled, resetTimer, isCreatorUser, showToast, ui, handleCameraInitialize, isReview]);

  const handleRecordStop = useCallback(() => {
    if (recorder.recordingState === 'recording' || recorder.recordingState === 'paused') {
      handleStopAndReleaseCamera();
    } else if (
      recorder.recordingState === 'idle' &&
      !ui.isDrawerVisible &&
      // A restored take reviews exactly like a live one: Space does not start
      // a fresh recording over the top of it. Recording again is a deliberate
      // click on Start / Record again.
      !isReview
    ) {
      void handleRecordStart();
    }
  }, [recorder, ui.isDrawerVisible, handleRecordStart, handleStopAndReleaseCamera, isReview]);

  // Closing the export sheet must never destroy the take. Users dismiss it
  // precisely to reach the Studio's "Preview as" switcher and change format, and
  // the recording has to survive that round trip. Discarding belongs to explicit
  // actions (record again / open library), never to dismissing a dialog.
  const handleDismissDrawer = useCallback(() => {
    ui.setIsDrawerVisible(false);
  }, [ui]);

  // "Record Again" — one label, two workflows.
  //
  //   Workflow B (`isLibraryOriginal`): the take is a library original — the
  //   user's existing video, promised to stay the same (LibraryPanel). It is
  //   not this session's to destroy, so Record Again runs the New Video
  //   transition: detach into a clean creation session, row stays in the
  //   library. The success screen's "Open My Library" button remains the way
  //   back to it.
  //
  //   Workflow A: the explicit discard of the take recorded in this session.
  //   It deletes the only copy of the bytes, so it says so first; cancelling
  //   leaves the take, the sheet and the review exactly as they were.
  const handlePracticeAgain = useCallback(() => {
    if (isLibraryOriginal) {
      handleNewVideo();
      return;
    }
    if (!window.confirm('Record Again discards this take and deletes it from your library. Continue?')) return;
    ui.setIsDrawerVisible(false);
    recorder.resetRecording();
    clearMasterRecording();
    clearJobs();
    setExportConfig(null);
  }, [isLibraryOriginal, handleNewVideo, ui, recorder, clearMasterRecording, clearJobs, setExportConfig]);

  // "Open My Library" is a navigation, not a discard. It must leave the master
  // recording untouched: this button sits on the post-export success screen, so
  // deleting here threw away the very take the user just exported and made
  // "change platform and export again" (Reels -> back to Review -> TikTok)
  // impossible without re-recording. The restore effect re-surfaces the take
  // when the user returns to Studio, which is the correct outcome.
  // Deleting the IndexedDB row belongs to the explicit discard only — the
  // Workflow A branch of handlePracticeAgain above, behind its confirmation.
  const handleOpenLibrary = useCallback(() => {
    ui.setIsDrawerVisible(false);
    setActivePanel('library');
  }, [ui]);

  const handleNudgeUp = useCallback(() => {
    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollBy({
        top: -NUDGE_AMOUNT_KEYBOARD,
        behavior: 'smooth',
      });
    }
  }, []);

  const handleNudgeDown = useCallback(() => {
    if (prompterContainerRef.current) {
      prompterContainerRef.current.scrollBy({
        top: NUDGE_AMOUNT_KEYBOARD,
        behavior: 'smooth',
      });
    }
  }, []);

  // The toggle only flips state: useMicMuteSync is the single writer of
  // track.enabled, so the button (and its aria-pressed) can never disagree
  // with the audio actually being recorded — including on a re-acquired
  // stream, where the tracks start enabled again.
  const handleMicToggle = useCallback(() => {
    setIsMicMuted((prev) => !prev);
  }, []);

  // DC-3 — the two navs mean different things and must not share a handler:
  //
  //   Desktop IconRail's entry is explicitly LABELED "New Video", so tapping
  //   it runs the full session reset (this was the pre-existing, correct
  //   behavior — the label promises it).
  //
  //   Compact BottomNav's "Studio" tab is a NAVIGATION tab. It used to run
  //   the same reset, so tapping a tab labeled "Studio" silently created a
  //   New Video: it cleared the current recording and released the master as
  //   a side effect of switching panels. It is now a pure panel switch; the
  //   BottomNav's explicit "New Video" button (onNewVideo) owns the reset on
  //   compact layouts.
  const handlePanelChange = useCallback((panel: TabType | 'record' | 'share') => {
    if (panel === 'studio') {
      handleNewVideo();
      return;
    }
    setActivePanel(panel);
  }, [handleNewVideo]);

  const handleCompactNav = useCallback((panel: TabType | 'record' | 'share') => {
    setActivePanel(panel);
  }, []);

  const handleToggleInspector = useCallback(() => {
    setIsInspectorOpen((prev) => !prev);
  }, []);

  const handleShowShortcuts = useCallback(() => {
    showToast('Space: Start / Stop recording · P: Pause / Resume · M: Mute microphone · ↑ ↓: Move text · Esc: Close');
  }, [showToast]);

  // (checkout intent effect above handles search cleanup)

  useKeyboardShortcuts({
    onRecordStop: handleRecordStop,
    onRecordPause: recorder.pauseRecording,
    onRecordResume: () =>
      recorder.resumeRecording(
        () => {
          if (!prompterContainerRef.current) return;
          const container = prompterContainerRef.current;
          const speed = settings.teleprompter.scrollSpeed;
          const multiplier = settings.teleprompter.scrollSpeedMultiplier;
          container.scrollTop += (speed / 20) * multiplier;
        },
        () => {
          if (!prompterContainerRef.current) return false;
          const container = prompterContainerRef.current;
          return (
            container.scrollTop + container.clientHeight >=
            container.scrollHeight - 5
          );
        }
      ),
    onMicToggle: handleMicToggle,
    onNudgeUp: handleNudgeUp,
    onNudgeDown: handleNudgeDown,
    onCloseDrawer: handleDismissDrawer,
    isRecording: recorder.recordingState === 'recording',
    isPaused: recorder.recordingState === 'paused',
    canRecord: !!camera.stream,
    isDrawerVisible: ui.isDrawerVisible,
    showNudgeToast: showToast,
  });

  const isStudio = activePanel === 'studio';

  const previewPreset = PLATFORM_PRESETS.find((p) => p.id === previewPlatformId) ?? PLATFORM_PRESETS[0];
  // Review crop geometry from the SAME production math the export uses
  // (getDefaultCrop → cover). Shape (Canvas box) and crop move together.
  const reviewCropStyle = isReview && masterRecordingData
    ? getPreviewCropGeometry(
        masterRecordingData.sourceWidth || 1920,
        masterRecordingData.sourceHeight || 1080,
        previewPreset.width,
        previewPreset.height,
      ).style
    : undefined;

  // Dimension accuracy: the badge shows what capture ACTUALLY is, never the
  // configured target dressed up as a captured resolution.
  //   - review      → the take's probed (real) dimensions;
  //   - live camera → the active MediaStream track's own settings;
  //   - no stream   → null, so Canvas labels the configured target as a
  //                   target rather than claiming it as capture.
  const activeVideoTrack = camera.stream?.getVideoTracks?.()[0];
  const trackSettings = activeVideoTrack?.getSettings?.();
  const liveCaptureSize =
    trackSettings && trackSettings.width && trackSettings.height
      ? { width: trackSettings.width, height: trackSettings.height }
      : null;
  const captureSize =
    isReview && masterRecordingData && masterRecordingData.sourceWidth > 0 && masterRecordingData.sourceHeight > 0
      ? { width: masterRecordingData.sourceWidth, height: masterRecordingData.sourceHeight }
      : liveCaptureSize;

  const inspectorProps = {
    settings: settings.teleprompter,
    onSettingsChange: settings.setTeleprompter,
    focusViewEnabled: focusView.isEnabled,
    onFocusViewToggle: focusView.toggle,
    mirrorCamera: settings.isMirrored,
    onMirrorCameraToggle: () => settings.setIsMirrored((prev) => !prev),
    countdownEnabled: settings.countdownEnabled,
    onCountdownToggle: () => settings.setCountdownEnabled((prev) => !prev),
    onUpgradeClick: handleUpgradeClick,
    teleprompterNotice,
    script: scriptStorage.script,
    onScriptChange: scriptStorage.setScript,
    onClearScript: scriptStorage.clearScript,
    wordCount: scriptStorage.wordCount,
    progress: scriptStorage.progress,
    onLoadInspiration: scriptStorage.loadInspiration,
  };

  return (
    <>
      <WelcomeModal
        isVisible={welcomeModal.isVisible}
        dontShowAgain={welcomeModal.dontShowAgain}
        onDontShowChange={welcomeModal.setDontShowAgain}
        onGetStarted={() => {
          welcomeModal.closeModal();
          if (!camera.isInitialized) handleCameraInitialize();
        }}
        onExploreStudio={welcomeModal.closeModal}
      />

      <div className="h-screen flex flex-col bg-canvas overflow-hidden">
        <Header
          isMobile={isMobile}
          hasRecording={isReview && !!masterRecordingData}
          onExport={() => ui.setIsDrawerVisible(true)}
          onShare={share}
          onToggleInspector={handleToggleInspector}
          onSignIn={ui.handleAuthRequired}
          userPlan={userPlan}
          onPricingClick={handlePricingClick}
        />

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <IconRail
            activePanel={activePanel}
            onPanelChange={handlePanelChange}
            onShowShortcuts={handleShowShortcuts}
          />

          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" role="main">
            <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${isStudio ? '' : 'hidden'}`}>
              {recorder.recordingState !== 'countdown' && recorder.recordingState !== 'recording' && recorder.recordingState !== 'paused' && (
                <DeviceSelectorBar
                  videoDevices={camera.videoDevices}
                  audioDevices={camera.audioDevices}
                  selectedVideoDevice={settings.selectedVideoDevice}
                  selectedAudioDevice={settings.selectedAudioDevice}
                  onVideoDeviceChange={handleVideoDeviceChange}
                  onAudioDeviceChange={handleAudioDeviceChange}
                  onRefresh={camera.refreshDevices}
                />
              )}

              <Canvas
                focusViewEnabled={focusView.isEnabled}
                onFocusViewToggle={focusView.toggle}
                aspectRatio={isReview ? previewPreset.aspectRatio : settings.aspectRatio}
                recordingConfig={recordingConfig}
                reviewVideoUrl={isReview && masterRecordingData ? masterRecordingData.url : undefined}
                reviewAspectRatio={isReview ? previewPreset.aspectRatio : undefined}
                reviewVideoStyle={reviewCropStyle}
                reviewHasAudio={isReview && masterRecordingData ? masterRecordingData.hasAudio : false}
                captureSize={captureSize}
              >
                <CameraPreview
                  stream={camera.stream}
                  isMirrored={settings.isMirrored}
                  focusViewEnabled={focusView.isEnabled}
                />

                {teleprompterDisabled ? (
                  <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
                    <div className="flex flex-col items-center gap-3 max-w-sm text-center rounded-xl bg-surface/95 border border-border-default p-5 shadow-2xl">
                      <span className="text-[12px] font-bold uppercase tracking-wider text-warning">Teleprompter limit reached</span>
                      <p className="text-[13px] text-text-secondary leading-relaxed">
                        Free plan includes 3 min of teleprompter per recording. Your recording continues — upgrade to Creator for unlimited teleprompter.
                      </p>
                      <button
                        onClick={handleUpgradeClick}
                        className="px-4 py-2 rounded-lg bg-accent text-white text-[12px] font-semibold transition-colors hover:bg-accent/90"
                      >
                        Upgrade to Creator
                      </button>
                    </div>
                  </div>
                ) : prompterScript ? (
                  <TeleprompterOverlay
                    ref={prompterContainerRef}
                    script={scriptStorage.script}
                    settings={settings.teleprompter}
                  />
                ) : null}

                <FocalGuideway position={settings.teleprompter.textStartPosition} />

                {camera.stream && !isReview && <EyeLineGuide />}

                <RecordingBadge recordingState={recorder.recordingState} />

                <Timer
                  isRunning={recorder.recordingState === 'recording'}
                  elapsedSeconds={elapsedSeconds}
                />

                <CountdownOverlay
                  countdownText={recorder.countdownText}
                  // The state itself is the truth: `countdown` is only ever
                  // entered when the countdown setting is on (FC-1.0).
                  isVisible={recorder.recordingState === 'countdown'}
                  onCancel={recorder.cancelCountdown}
                />

                {!camera.isInitialized && !camera.hasInitialized && (
                  <InitOverlay
                    onInitialize={handleCameraInitialize}
                    status={camera.status === 'ready' ? 'idle' : camera.status}
                    errorMessage={camera.errorMessage}
                  />
                )}
              </Canvas>

              {/* "Preview as" platform switcher — only during review */}
              {isReview && masterRecordingData && (
                <>
                  <PlatformPreviewSwitcher
                    selectedPlatformId={previewPlatformId}
                    onSelect={setPreviewPlatformId}
                    isLocked={(id) => !isCreatorUser && isPlatformLockedForUser(id, session?.user?.plan || 'free')}
                    onLockedClick={(id) => {
                      handlePlatformUpgradeRequired(id);
                    }}
                  />
                  <div className="flex items-center justify-center gap-3 pb-3">
                    <span className="text-[12px] text-text-secondary">
                      {previewPreset.label} · {previewPreset.sublabel}
                    </span>
                    <button
                      onClick={() => {
                        // Drive the export from the previewed platform directly:
                        // the modal must open on the SAME platform the user just
                        // previewed (single source of truth: PLATFORM_PRESETS).
                        const srcW = masterRecordingData.sourceWidth || 1920;
                        const srcH = masterRecordingData.sourceHeight || 1080;
                        settings.setPlatformId(previewPlatformId);
                        selectPlatform(
                          previewPlatformId,
                          srcW,
                          srcH,
                          getEntitlements(userPlan).maxResolution,
                        );
                        ui.setIsDrawerVisible(true);
                      }}
                      className="px-5 py-2 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent/90 transition-colors"
                    >
                      Export
                    </button>
                  </div>
                </>
              )}
            </div>

            {activePanel === 'library' && (
              <div className="flex-1 min-h-0 overflow-auto">
                <RecordingsPanel
                  isMobile={isMobile}
                  isAuthenticated={!!session?.user}
                  userPlan={userPlan}
                  refreshKey={exportJobs.length}
                  onAuthRequired={ui.handleAuthRequired}
                  // Workflow B: attach the EXISTING master. This used to call
                  // createMasterRecording, which minted a fresh
                  // `master-<ts>-<rand>` id and re-saved the row — so opening a
                  // library item forked it into a second, identical recording
                  // and orphaned the original id, on every single open. The
                  // stored row IS the master; its identity is adopted verbatim.
                  onExportRecording={(recording) => {
                    openStoredRecording(recording);
                    ui.setIsDrawerVisible(true);
                  }}
                  previewPlatformId={previewPlatformId}
                  onPreviewPlatformChange={setPreviewPlatformId}
                  isPlatformLocked={(id) =>
                    !isCreatorUser && isPlatformLockedForUser(id, session?.user?.plan || 'free')
                  }
                  onLockedPlatformClick={handlePlatformUpgradeRequired}
                />
              </div>
            )}

            {isStudio && (
              <TransportBar
                recordingState={recorder.recordingState}
                // Enabled with a live stream, after a released take (Start
                // re-acquires), or straight out of a restored review — the
                // return trip after an upgrade lands in a fresh document with
                // no camera, and the review canvas covers the Enable-camera
                // overlay. Pre-permission users outside review go through that
                // overlay instead; the button stays disabled for them. Never
                // during an in-flight permission request.
                canRecord={(!!camera.stream || camera.hasInitialized || isReview) && camera.status !== 'requesting'}
                hasRecording={isReview}
                isMicMuted={isMicMuted}
                elapsedSeconds={elapsedSeconds}
                dailyRemainingSeconds={dailyRemainingDisplay}
                dailyRemainingTotalSeconds={FREE_DAILY_RECORDING_SECONDS}
                onMicToggle={handleMicToggle}
                onStart={handleRecordStart}
                onPause={recorder.pauseRecording}
                onResume={() =>
                  recorder.resumeRecording(
                    () => {
                      if (!prompterContainerRef.current) return;
                      const container = prompterContainerRef.current;
                      const speed = settings.teleprompter.scrollSpeed;
                      const multiplier = settings.teleprompter.scrollSpeedMultiplier;
                      container.scrollTop += (speed / 20) * multiplier;
                    },
                    () => {
                      if (!prompterContainerRef.current) return false;
                      const container = prompterContainerRef.current;
                      return (
                        container.scrollTop + container.clientHeight >=
                        container.scrollHeight - 5
                      );
                    }
                  )
                }
                onStop={handleStopAndReleaseCamera}
              />
            )}
          </main>

          <div className={isStudio ? '' : 'hidden'}>
            <InspectorPanel
              {...inspectorProps}
              isDrawer={isCompactLayout}
              isOpen={isInspectorOpen}
              onClose={handleToggleInspector}
              inspectorContext={inspectorContext}
            />
          </div>
        </div>

        <BottomNav
          activePanel={activePanel}
          onPanelChange={handleCompactNav}
          onNewVideo={handleNewVideo}
          onSettingsToggle={handleToggleInspector}
        />

        <Footer showShortcuts={isStudio} />
      </div>

      <ExportModal
        isVisible={ui.isDrawerVisible}
        masterRecording={masterRecordingData}
        onClose={handleDismissDrawer}
        initialPlatformId={previewPlatformId}
        onPracticeAgain={handlePracticeAgain}
        onOpenLibrary={handleOpenLibrary}
        onShare={share}
        showToast={showToast}
        isAuthenticated={!!session?.user}
        userPlan={session?.user?.plan || 'free'}
        onAuthRequired={ui.handleAuthRequired}
        onDownloadLimitReached={handleUpgradeClick}
        exportConfig={exportConfig}
        onSelectPlatform={selectPlatform}
        onStartExport={startExport}
        onCancelExport={() => cancelExport(exportJobs[exportJobs.length - 1]?.id || '')}
      />

      <PricingModal
        isOpen={ui.isPricingModalOpen}
        onClose={() => {
          ui.setIsPricingModalOpen(false);
          setCheckoutIntent(null);
          setPricingInitialStep('select');
          // Clear upgrade intent if payment wasn't completed
          try { window.localStorage.removeItem('sxs-upgrade-intent'); } catch {}
        }}
        showToast={showToast}
        userPlan={session?.user?.plan || 'free'}
        isAuthenticated={!!session?.user}
        onAuthRequired={handlePricingAuthRequired}
        initialTier={checkoutIntent?.tier}
        initialBillingPeriod={checkoutIntent?.billingPeriod}
        initialStep={pricingInitialStep}
      />

      <UpgradePromptModal
        platform={lockedPlatform}
        isAuthenticated={!!session?.user}
        onClose={() => {
          setLockedPlatform(null);
          try { window.localStorage.removeItem('sxs-upgrade-intent'); } catch {}
        }}
        onUpgrade={handleUpgradeFromPrompt}
      />

      <AuthModal
        isOpen={ui.isAuthModalOpen}
        onClose={() => {
          setPendingPricingAfterAuth(false);
          ui.setIsAuthModalOpen(false);
        }}
        onSuccess={handleAuthSuccessWithPricing}
        mode="download"
      />

      <ActivationModal
        isOpen={activationModal.isOpen}
        plan={activationModal.plan}
        orderId={activationModal.orderId}
        onRetry={() => {
          // Straight back to the payment form. The order intent is left in
          // localStorage on purpose: if this attempt does settle, the
          // closed-loop restore below still knows which format to reopen on.
          setPricingInitialStep('form');
          ui.setIsPricingModalOpen(true);
        }}
        onClose={(outcome) => {
          setActivationModal({ isOpen: false, plan: '', orderId: null });

          if (outcome === 'failed') {
            // Nothing was activated, so nothing may be treated as if it were.
            // Dropping the platform intent matters: it is what re-opens the
            // "Create for {format} with Creator" prompt on every later load,
            // so a declined payment would otherwise keep asking.
            try { window.localStorage.removeItem('sxs-upgrade-intent'); } catch {}
            return;
          }

          // Closed-loop upgrade: restore the platform the user was trying to use.
          // ExportModal reads `previewPlatformId` (its initialPlatformId), not
          // `settings.platformId` — the latter only drives recorder capture via
          // useStudioConfig. Setting it alone reopened the sheet on the default
          // format, silently dropping the plan the user just paid for.
          try {
            const pendingPlatform = window.localStorage.getItem('sxs-upgrade-intent');
            if (pendingPlatform) {
              window.localStorage.removeItem('sxs-upgrade-intent');
              const restored = pendingPlatform as PlatformId;
              settings.setPlatformId(restored);
              setPreviewPlatformId(restored);
              // IndexedDB restore is async, so the take may not be back in
              // state yet when the user dismisses the activation modal.
              // Opening the sheet with no master renders nothing at all, which
              // reads as a dead screen — so drive the selection now and only
              // auto-open once the take is actually there.
              const openSheet = (attempt = 0) => {
                if (masterRecordingData) {
                  selectPlatform(
                    restored,
                    masterRecordingData.sourceWidth || 1920,
                    masterRecordingData.sourceHeight || 1080,
                    getEntitlements(userPlan).maxResolution,
                  );
                  setTimeout(() => ui.setIsDrawerVisible(true), 300);
                  return;
                }
                if (attempt >= 10) return;
                setTimeout(() => openSheet(attempt + 1), 200);
              };
              openSheet();
            }
          } catch {}
        }}
      />

      <Toast message={toast?.message ?? null} queueLength={queueLength} />
    </>
  );
}
