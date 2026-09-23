'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { NUDGE_AMOUNT_KEYBOARD, PLATFORM_PRESETS } from '@/constants';

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

import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useStudioCamera } from '@/hooks/useStudioCamera';
import { useRecordingTimer } from '@/hooks/useRecordingTimer';
import { useStudioUI } from '@/hooks/useStudioUI';
import { useHydrated } from '@/hooks/useHydrated';
import { getEntitlements, isCreatorPlan, isPlatformLockedForUser, FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';
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
  const { masterRecording: masterRecordingData, createMasterRecording, clearMasterRecording, restoreMasterRecording } = useMasterRecording();
  // Guard: completion effect must run once per recording blob.
  // `ui` is a new object every render, so including it in deps would
  // re-create the master recording (and revoke the preview URL) on every
  // re-render while state stays 'completed' — breaking preview + spamming
  // blob ERR_FILE_NOT_FOUND.
  const setDrawerVisible = ui.setIsDrawerVisible;
  const processedRecordingRef = useRef<Blob | null>(null);

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

  // Detect ?payment=success query param after Cashfree redirect
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
  const entitlements = getEntitlements((session?.user?.plan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly') || 'free');
  // Free: a single recording can never exceed the day's remaining budget
  // (e.g. 4 min used → next recording auto-stops at 6 min). Creator: null = unlimited.
  const recordingCap = isCreatorUser
    ? null
    : Math.max(1, Math.min(entitlements.maxDurationSeconds ?? 600, getDailyRecordingRemainingInFlight(0)));
  const { elapsedSeconds, resetTimer } = useRecordingTimer({
    recordingState: recorder.recordingState,
    stopRecording: recorder.stopRecording,
    showToast,
    maxDurationSeconds: recordingCap,
    resetOnComplete: false,
  });

  const isRecordingOrPaused = recorder.recordingState === 'recording' || recorder.recordingState === 'paused';
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
  const [activePanel, setActivePanel] = useState<TabType | 'record' | 'share'>('studio');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);

  useEffect(() => {
    if (isMobile) setIsInspectorOpen(false);
  }, [isMobile]);
  const prompterContainerRef = useRef<HTMLDivElement>(null);

  const {
    exportConfig,
    exportJobs,
    setExportConfig,
    selectPlatform,
    updateCrop,
    startExport,
    startBatchExport,
    cancelExport,
    clearJobs,
  } = useExportPipeline();

  // Restore master recording from IndexedDB on mount
  useEffect(() => {
    if (!masterRecordingData) {
      restoreMasterRecording();
    }
  }, [masterRecordingData, restoreMasterRecording]);

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
      if (!isCreatorUser && recorder.recordingResult?.duration) {
        addDailyRecordingSeconds(recorder.recordingResult.duration);
      }

      if (recorder.recordingResult?.blob) {
        // Extract actual video dimensions from the recorded blob
        // Camera track settings can differ from actual MediaRecorder output
        const result = recorder.recordingResult;
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
          cleanupProbe();
          createMasterRecording(
            result.blob,
            result.duration,
            result.hasAudio,
            actualWidth,
            actualHeight
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
            recordingConfig.height
          );
        };
      }

    resetTimer();
  }, [recorder.recordingState, recorder.recordingResult, createMasterRecording, recordingConfig.width, recordingConfig.height, isCreatorUser, setDrawerVisible, resetTimer]);

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

  const handleRecordStart = useCallback(() => {
    if (!camera.stream) return;

    // Free: the teleprompter allotment is per-recording (fresh 3 min per take) and only
    // hides mid-recording — it never blocks or stops a take. The daily recording budget is
    // the single gate below; teleprompter time never deducts from it.

    // Free: enforce 10 min TOTAL recording per day (downloads stay unlimited)
    if (!isCreatorUser && !canRecordToday()) {
      showToast('Daily recording limit reached (10 min/day on Free). Upgrade to Creator for unlimited recording.');
      ui.setIsPricingModalOpen(true);
      return;
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

    recorder.startRecording(scrollCallback, checkEndCallback);
  }, [camera.stream, recorder, settings.teleprompter.scrollSpeed, settings.teleprompter.scrollSpeedMultiplier, resetTimer, isCreatorUser, showToast, ui]);

  const handleRecordStop = useCallback(() => {
    if (recorder.recordingState === 'recording' || recorder.recordingState === 'paused') {
      recorder.stopRecording();
    } else if (
      recorder.recordingState === 'idle' &&
      camera.stream &&
      !ui.isDrawerVisible
    ) {
      handleRecordStart();
    }
  }, [recorder, camera.stream, ui.isDrawerVisible, handleRecordStart]);

  const handleCloseDrawer = useCallback(() => {
    if (recorder.recordingState === 'completed' && masterRecordingData) {
      if (!window.confirm('Discard this recording? This cannot be undone.')) {
        return;
      }
    }
    ui.setIsDrawerVisible(false);
    if (recorder.recordingState === 'completed') {
      recorder.resetRecording();
      clearMasterRecording();
      clearJobs();
      setExportConfig(null);
    }
  }, [ui, recorder, clearMasterRecording, clearJobs, setExportConfig, masterRecordingData]);

  const handlePracticeAgain = useCallback(() => {
    ui.setIsDrawerVisible(false);
    recorder.resetRecording();
    clearMasterRecording();
    clearJobs();
    setExportConfig(null);
  }, [ui, recorder, clearMasterRecording, clearJobs, setExportConfig]);

  const handleOpenLibrary = useCallback(() => {
    ui.setIsDrawerVisible(false);
    recorder.resetRecording();
    clearMasterRecording();
    clearJobs();
    setExportConfig(null);
    setActivePanel('library');
  }, [ui, recorder, clearMasterRecording, clearJobs, setExportConfig]);

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

  const handleMicToggle = useCallback(() => {
    setIsMicMuted((prev) => {
      const nextMuted = !prev;
      if (camera.stream) {
        camera.stream.getAudioTracks().forEach((track) => {
          track.enabled = !nextMuted;
        });
      }
      return nextMuted;
    });
  }, [camera.stream]);

  const handlePanelChange = useCallback((panel: TabType | 'record' | 'share') => {
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
    onCloseDrawer: handleCloseDrawer,
    isRecording: recorder.recordingState === 'recording',
    isPaused: recorder.recordingState === 'paused',
    canRecord: !!camera.stream,
    isDrawerVisible: ui.isDrawerVisible,
    showNudgeToast: showToast,
  });

  const isStudio = activePanel === 'studio';

  // The active creation phase drives progressive disclosure across the UI.
  // 'preparing' → script + teleprompter focused; 'recording' → camera only;
  // 'review' → the take exists, output/platform becomes relevant.
  const inspectorContext =
    recorder.recordingState === 'recording' || recorder.recordingState === 'paused' || recorder.recordingState === 'countdown'
      ? 'recording'
      : recorder.recordingState === 'completed'
        ? 'review'
        : 'preparing';

  // Preview platform for "Preview as" — separate from export platform
  const [previewPlatformId, setPreviewPlatformId] = useState<PlatformId>('youtube-landscape');
  const isReview = inspectorContext === 'review';
  const previewPreset = PLATFORM_PRESETS.find((p) => p.id === previewPlatformId) ?? PLATFORM_PRESETS[0];

  const inspectorProps = {
    settings: settings.teleprompter,
    onSettingsChange: settings.setTeleprompter,
    focusViewEnabled: focusView.isEnabled,
    onFocusViewToggle: focusView.toggle,
    mirrorCamera: settings.isMirrored,
    onMirrorCameraToggle: () => settings.setIsMirrored((prev) => !prev),
    countdownEnabled: settings.countdownEnabled,
    onCountdownToggle: () => settings.setCountdownEnabled((prev) => !prev),
    videoDevices: camera.videoDevices,
    audioDevices: camera.audioDevices,
    selectedVideoDevice: settings.selectedVideoDevice,
    selectedAudioDevice: settings.selectedAudioDevice,
    onVideoDeviceChange: handleVideoDeviceChange,
    onAudioDeviceChange: handleAudioDeviceChange,
    platformId: settings.platformId,
    onPlatformChange: settings.setPlatformId,
    userPlan: session?.user?.plan || 'free',
    isAuthenticated: !!session?.user,
    onUpgradeRequired: handlePlatformUpgradeRequired,
    teleprompterNotice,
    customAspectRatio: settings.customAspectRatio,
    onCustomAspectRatioChange: settings.setCustomAspectRatio,
    customWidth: settings.customWidth,
    onCustomWidthChange: settings.setCustomWidth,
    customHeight: settings.customHeight,
    onCustomHeightChange: settings.setCustomHeight,
    aspectRatio: settings.aspectRatio,
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
          hasRecording={recorder.recordingState === 'completed' && !!masterRecordingData}
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

                <RecordingBadge recordingState={recorder.recordingState} />

                <Timer
                  isRunning={recorder.recordingState === 'recording'}
                  elapsedSeconds={elapsedSeconds}
                />

                <CountdownOverlay
                  countdownText={recorder.countdownText}
                  isVisible={recorder.recordingState === 'countdown' && settings.countdownEnabled}
                />

                {!camera.isInitialized && (
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
                        // Set the export platform to the preview platform, then open ExportModal
                        settings.setPlatformId(previewPlatformId);
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
                  onExportRecording={(recording) => {
                    createMasterRecording(
                      recording.blob,
                      recording.duration,
                      recording.hasAudio,
                      recording.width,
                      recording.height
                    );
                    ui.setIsDrawerVisible(true);
                  }}
                />
              </div>
            )}

            {isStudio && (
              <TransportBar
                recordingState={recorder.recordingState}
                canRecord={!!camera.stream}
                hasRecording={recorder.recordingState === 'completed'}
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
                onStop={recorder.stopRecording}
              />
            )}
          </main>

          <div className={isStudio ? '' : 'hidden'}>
            <InspectorPanel
              {...inspectorProps}
              isMobile={isMobile}
              isOpen={isInspectorOpen}
              onClose={handleToggleInspector}
              inspectorContext={inspectorContext}
            />
          </div>
        </div>

        <BottomNav
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          onSettingsToggle={handleToggleInspector}
        />

        <Footer showShortcuts={isStudio} />
      </div>

      <ExportModal
        isVisible={ui.isDrawerVisible}
        masterRecording={masterRecordingData}
        onClose={handleCloseDrawer}
        onPracticeAgain={handlePracticeAgain}
        onOpenLibrary={handleOpenLibrary}
        onShare={share}
        showToast={showToast}
        isAuthenticated={!!session?.user}
        userPlan={session?.user?.plan || 'free'}
        onAuthRequired={ui.handleAuthRequired}
        onDownloadLimitReached={handleUpgradeClick}
        onUpgradeRequired={handlePlatformUpgradeRequired}
        exportConfig={exportConfig}
        onSelectPlatform={selectPlatform}
        onUpdateCrop={updateCrop}
        onStartExport={startExport}
        onStartBatchExport={startBatchExport}
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
        onClose={() => {
          setActivationModal({ isOpen: false, plan: '', orderId: null });
          // Closed-loop upgrade: restore the platform the user was trying to use
          try {
            const pendingPlatform = window.localStorage.getItem('sxs-upgrade-intent');
            if (pendingPlatform) {
              window.localStorage.removeItem('sxs-upgrade-intent');
              settings.setPlatformId(pendingPlatform as PlatformId);
              // Open export modal with the newly unlocked platform
              setTimeout(() => ui.setIsDrawerVisible(true), 300);
            }
          } catch {}
        }}
      />

      <Toast message={toast?.message ?? null} queueLength={queueLength} />
    </>
  );
}
