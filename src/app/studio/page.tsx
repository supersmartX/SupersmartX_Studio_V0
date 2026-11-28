'use client';

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { ASPECT_RATIO_PRESETS, NUDGE_AMOUNT_KEYBOARD, PLATFORM_PRESETS, DEFAULT_PLATFORM_ID } from '@/constants';

import { useWelcomeModal } from '@/hooks/useWelcomeModal';
import { useCamera } from '@/hooks/useCamera';
import { useRecorder } from '@/hooks/useRecorder';
import { useScreenCapture } from '@/hooks/useScreenCapture';
import { useScriptStorage } from '@/hooks/useScriptStorage';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFocusView } from '@/hooks/useFocusView';
import { useToast } from '@/hooks/useToast';
import { useShare } from '@/hooks/useShare';
import { useMasterRecording } from '@/hooks/useMasterRecording';
import { useExportPipeline } from '@/hooks/useExportPipeline';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useMicMuteSync } from '@/hooks/useMicMuteSync';
import { useVoiceFollow } from '@/hooks/useVoiceFollow';
import { useScreenCameraComposition } from '@/hooks/useScreenCameraComposition';
import { FALLBACK_CAMERA_ASPECT, FALLBACK_CANVAS_WIDTH, FALLBACK_CANVAS_HEIGHT } from '@/lib/recording/webcam-overlay';

import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useStudioCamera } from '@/hooks/useStudioCamera';
import { useRecordingTimer } from '@/hooks/useRecordingTimer';
import { useStudioUI } from '@/hooks/useStudioUI';
import { useHydrated } from '@/hooks/useHydrated';
import { getEntitlements, isCreatorPlan, isPlatformLockedForUser, canVoiceFollow } from '@/lib/entitlements';
import { getPreviewCropGeometry } from '@/lib/composition';
import { consumePendingDownloadExportId, hasPendingDownload } from '@/lib/auth-guard';
import { isReviewState, resolveStudioPhase } from '@/lib/review-state';
import { addDailyRecordingSeconds, canRecordToday, getDailyRecordingRemainingInFlight } from '@/lib/daily-recording';
import { getTeleprompterSessionCap, getTeleprompterRemainingInSession } from '@/lib/teleprompter-session';
import { runRecordingPreflight } from '@/lib/recording/preflight';
import { readTrackCaptureInfo, buildPreferredAudioConstraints } from '@/lib/recording/capture-constraints';
import { deriveAspectRatioLabel } from '@/lib/recording/aspect-ratio';
import { getRecording, saveRecording, type StoredRecording } from '@/lib/recording-store';
import {
  createRecordingRecoverySink,
  findRecoverableSession,
  assembleRecoveryBlob,
  sweepAbandonedSessions,
  type RecordingRecoverySink,
} from '@/lib/recording/recovery';
import { deleteChunkSession, type RecordingBackupState } from '@/lib/recording/chunk-store';

import { Header } from '@/components/layout/Header';
import { IconRail } from '@/components/layout/IconRail';
import { CompactNavMenu } from '@/components/layout/CompactNavMenu';
import { InspectorPanel } from '@/components/layout/InspectorPanel';
import { Canvas } from '@/components/layout/Canvas';
import { RecordingFormatPicker, FreeRotateNudge } from '@/components/studio/RecordingFormatPicker';
import { TransportBar } from '@/components/layout/TransportBar';
import { Footer } from '@/components/layout/Footer';
import { CameraPreview } from '@/components/studio/CameraPreview';
import { CameraOffOverlay } from '@/components/studio/CameraOffOverlay';
import { TeleprompterOverlay } from '@/components/studio/TeleprompterOverlay';
import { RecordingBadge } from '@/components/studio/RecordingBadge';
import { Timer } from '@/components/studio/Timer';
import { CountdownOverlay } from '@/components/studio/CountdownOverlay';
import { InitOverlay } from '@/components/studio/InitOverlay';
import { FocalGuideway } from '@/components/studio/FocalGuideway';
import { WelcomeModal } from '@/components/dialogs/WelcomeModal';
import { ExportModal } from '@/components/dialogs/ExportModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PricingModal } from '@/components/dialogs/PricingModal';
import { UpgradePromptModal } from '@/components/dialogs/UpgradePromptModal';
import { AuthModal } from '@/components/auth/AuthModal';
import { PlatformPreviewSwitcher } from '@/components/studio/PlatformPreviewSwitcher';
import { RecordingsPanel } from '@/components/studio/LibraryPanel';
import { RecordingStatusLine } from '@/components/studio/RecordingStatusLine';
import { ScreenWebcamPreview } from '@/components/studio/ScreenWebcamPreview';
import { WebcamToolbar, ScreenShareActions } from '@/components/studio/WebcamToolbar';
import { Toast } from '@/components/common/Toast';
import { ScreenShareIcon, TrashIcon } from '@/components/icons';
import { formatTime } from '@/utils/format';
import type { TabType, PlatformId, PlatformPreset, MasterRecording, CaptureSource } from '@/types';

export default function HomePage() {
  // Base hooks (called first, no ordering dependency)
  const welcomeModal = useWelcomeModal();
  const { toast, showToast, queueLength } = useToast();
  const { share } = useShare(showToast);
  const focusView = useFocusView();
  const scriptStorage = useScriptStorage();
  const hydrated = useHydrated();
  const { data: session, status: sessionStatus, update } = useSession();
  const userPlan = (session?.user?.plan as 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly') || 'free';
  const isCreatorUser = isCreatorPlan(userPlan);

  // Core infrastructure hooks
  const { settings, recordingConfig } = useStudioConfig();
  const [captureSource, setCaptureSource] = useState<CaptureSource>('camera');
  const camera = useCamera();

  const screenMicStreamRef = useRef<MediaStream | null>(null);
  const [screenMicStream, setScreenMicStream] = useState<MediaStream | null>(null);
  const stopScreenMicStream = useCallback(() => {
    const current = screenMicStreamRef.current;
    screenMicStreamRef.current = null;
    if (current) {
      current.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    }
    setScreenMicStream(null);
  }, []);

  const handleScreenStreamEndedRef = useRef<() => void>(() => {});
  const screenCapture = useScreenCapture({
    onStreamEnded: () => handleScreenStreamEndedRef.current(),
  });

  // Screen-share interlock: the teleprompter is a private reading aid, so it
  // must never render while the user's screen is being shared. Suppression is
  // a pure display gate — the script (the prompter's persisted state) is never
  // touched — so when sharing ends for any reason (Stop sharing, the browser's
  // native sharing bar, a cancelled or failed request) the overlay comes back
  // exactly as it was and nothing is left disabled.
  const isScreenShareActive = screenCapture.isActive;

  const screenVideoTrack = captureSource !== 'camera' ? (screenCapture.stream?.getVideoTracks()[0] ?? null) : null;
  const cameraMicTrack = captureSource === 'screen'
    ? (camera.stream?.getAudioTracks().find((t) => t.readyState === 'live') ?? null)
    : null;
  const screenMicTrack = captureSource === 'screen'
    ? (screenMicStream?.getAudioTracks().find((t) => t.readyState === 'live') ?? null)
    : null;
  const activeMicTrack = cameraMicTrack ?? screenMicTrack;

  // Screen + Webcam composition (Loom-style). The screen, camera and mic stay
  // separate sources; the compositor paints them into one canvas each frame
  // and hands the existing recorder a single composed MediaStream. Changing
  // the webcam's visibility/position/shape mid-take only affects the draw
  // pass — the composed stream identity (and therefore the recording) holds.
  const cameraAspect = useMemo(() => {
    const track = camera.stream?.getVideoTracks()[0];
    if (!track || typeof track.getSettings !== 'function') return FALLBACK_CAMERA_ASPECT;
    try {
      const s = track.getSettings();
      if (s.width && s.height) return s.width / s.height;
    } catch { /* test doubles */ }
    return FALLBACK_CAMERA_ASPECT;
  }, [camera.stream]);

  // The composed canvas adopts the RECORDING FORMAT's shape: the screen share
  // is center-cropped into it, so the preview fills the platform frame edge
  // to edge and the webcam overlay is positioned in export-true coordinates.
  const captureAspectPreset = ASPECT_RATIO_PRESETS[settings.aspectRatio] ?? ASPECT_RATIO_PRESETS['16:9'];
  const composition = useScreenCameraComposition({
    screenStream: captureSource === 'screen-camera' ? screenCapture.stream : null,
    cameraStream: captureSource === 'screen-camera' ? camera.stream : null,
    overlay: settings.webcamOverlay,
    cameraAspect,
    canvasAspect: captureAspectPreset.width / captureAspectPreset.height,
    enabled: captureSource === 'screen-camera',
  });

  const activeCaptureStream = useMemo(() => {
    if (captureSource === 'screen-camera') return composition.composedStream;
    if (captureSource !== 'screen') return camera.stream;
    if (!screenVideoTrack) return null;
    return new MediaStream([screenVideoTrack, ...(activeMicTrack ? [activeMicTrack] : [])]);
  }, [captureSource, camera.stream, screenVideoTrack, activeMicTrack, composition.composedStream]);

  const recorder = useRecorder(activeCaptureStream);

  // Camera management hook (device auto-selection is driven by the page, so
  // the hook stays a set of stable callbacks).
  const { handleCameraInitialize, handleVideoDeviceChange, handleAudioDeviceChange, autoSelectDevices } = useStudioCamera({
    settings,
    camera,
  });
  useEffect(() => {
    autoSelectDevices();
  }, [autoSelectDevices]);

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
  } = useMasterRecording({
    // Surfaced instead of a silent no-op: the take works in this session, but
    // the library row (the copy that survives a reload) was never written.
    onSaveError: () =>
      showToast('Your video is ready here, but we could not save it to your library. Keep this tab open to export it.'),
  });
  // Guard: completion effect must run once per recording blob.
  // `ui` is a new object every render, so including it in deps would
  // re-create the master recording (and revoke the preview URL) on every
  // re-render while state stays 'completed' — breaking preview + spamming
  // blob ERR_FILE_NOT_FOUND.
  const setDrawerVisible = ui.setIsDrawerVisible;
  const processedRecordingRef = useRef<Blob | null>(null);

  // Local recovery copy (Phase 9) — one sink per page. The recorder feeds it
  // every chunk; it publishes the REAL backup state the status line shows.
  const recoverySinkRef = useRef<RecordingRecoverySink | null>(null);
  if (!recoverySinkRef.current) {
    recoverySinkRef.current = createRecordingRecoverySink();
  }
  const recoverySink = recoverySinkRef.current;
  const [backupState, setBackupState] = useState<RecordingBackupState>('inactive');
  useEffect(() => {
    return recoverySink.subscribe(() => setBackupState(recoverySink.getState()));
  }, [recoverySink]);

  // The active creation phase drives progressive disclosure across the UI.
  // Preparing shows script setup; recording keeps live reading controls.
  // 'review' → the take exists, output/platform becomes relevant.
  //
  // Both the phase and the review flag are resolved in one place
  // (src/lib/review-state.ts) because the take can arrive two ways: finished
  // in this document, or restored from IndexedDB after a cross-document hop
  // (Google OAuth, the Paddle redirect, the return trip, a reload). Every
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

  // Stop unmounts the focused Stop button, which drops keyboard focus to the
  // document body. Move it to the review surface once the take is ready so the
  // next Tab reaches Delete / Retake / Export instead of starting over in the
  // header. Only a real capture→review transition does this; opening a library
  // recording (or reloading into review) should not steal focus.
  const reviewTrayRef = useRef<HTMLDivElement | null>(null);
  const wasCapturingRef = useRef(false);
  useEffect(() => {
    const capturing =
      recorder.recordingState === 'recording' ||
      recorder.recordingState === 'paused' ||
      recorder.recordingState === 'countdown';
    if (capturing) {
      wasCapturingRef.current = true;
      return;
    }
    if (!wasCapturingRef.current || !isReview || !masterRecordingData) return;
    wasCapturingRef.current = false;
    // One frame for the tray to commit; focusing a node from the same commit
    // that removed Stop is a no-op in some browsers. If the user already moved
    // on (Export opened its dialog, a header control was clicked), leave that
    // focus alone instead of pulling it into the tray mid-action.
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      reviewTrayRef.current?.focus({ preventScroll: true });
    }, 80);
  }, [recorder.recordingState, isReview, masterRecordingData]);

  const [pendingPricingAfterAuth, setPendingPricingAfterAuth] = useState(false);
  // Checkout intent from landing page (e.g. ?checkout=creator_monthly → preselect Creator Monthly)
  const [checkoutIntent, setCheckoutIntent] = useState<{ tier: 'creator'; billingPeriod: 'monthly' | 'yearly' } | null>(null);
  // UX-005: which AuthModal screen to open — 'login' for header "Log in",
  // 'register' (default) for every purchase/guard flow, set at open time.
  const [authIntent, setAuthIntent] = useState<'register' | 'login'>('register');

  const handlePricingClick = useCallback(() => {
    ui.setIsPricingModalOpen(true);
  }, [ui]);

  const handleUpgradeClick = useCallback(() => {
    ui.setIsPricingModalOpen(true);
  }, [ui]);

  const [lockedPlatform, setLockedPlatform] = useState<PlatformPreset | null>(null);

  // Paddle redirects are informational only. On return, use the client marker
  // solely to locate the server-side reservation and transaction. The server
  // activation endpoint re-fetches Paddle, verifies correlation, reconciles
  // the entitlement, and is the only authority for Creator access.
  const checkoutReturnHandledRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Do not consume the handoff while Auth.js is resolving. The return page
    // can render before the authenticated session arrives; deleting the marker
    // here would permanently skip server-authoritative reconciliation.
    if (sessionStatus === 'loading') return;
    const params = new URLSearchParams(window.location.search);
    type CheckoutHandoff = { transactionId?: unknown; reservationId?: unknown; createdAt?: unknown };
    let handoff: CheckoutHandoff = {};
    try {
      const raw = window.sessionStorage.getItem('sxs-checkout-return');
      if (raw) handoff = JSON.parse(raw) as CheckoutHandoff;
    } catch {}

    const transactionId = typeof handoff?.transactionId === 'string' ? handoff.transactionId : null;
    const reservationId = typeof handoff?.reservationId === 'string' ? handoff.reservationId : null;
    const createdAt = typeof handoff?.createdAt === 'number' ? handoff.createdAt : 0;
    const isRecent = createdAt > 0 && Date.now() - createdAt < 24 * 60 * 60 * 1000;

    if (params.has('payment') || params.has('transaction_id') || params.has('order_id')) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (session?.user?.id && transactionId && reservationId && isRecent && !checkoutReturnHandledRef.current) {
      checkoutReturnHandledRef.current = true;
      let cancelled = false;
      const verifyReturn = async () => {
        for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
          try {
            const response = await fetch(
              `/api/paddle/activation?reservationId=${encodeURIComponent(reservationId)}&transactionId=${encodeURIComponent(transactionId)}`,
              { credentials: 'same-origin', cache: 'no-store' },
            );
            const result = await response.json().catch(() => ({})) as { status?: string };
            if (result.status === 'activated') {
              try { await update(); } catch {}
              if (!cancelled) showToast('Creator access activated.');
              return;
            }
            if (result.status === 'failed') return;
          } catch {}
          if (attempt < 5) await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
      };
      void verifyReturn();
      try { window.sessionStorage.removeItem('sxs-checkout-return'); } catch {}
      return () => { cancelled = true; };
    }

    try { window.sessionStorage.removeItem('sxs-checkout-return'); } catch {}
  }, [session?.user?.id, sessionStatus, showToast, update]);

  // Free capture is YouTube 16:9 widescreen only. A persisted Creator choice
  // (or a stale upgrade-restore) must not leak a locked capture format into
  // a Free session — the picker itself blocks the selection, this is the
  // backstop. Loading is NOT Free: while the session is unresolved the plan
  // reads as 'free', so running this then would reset a Creator's chosen
  // format on every page load before their plan arrived.
  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (!isCreatorUser && settings.platformId !== DEFAULT_PLATFORM_ID) {
      settings.setPlatformId(DEFAULT_PLATFORM_ID);
    }
  }, [isCreatorUser, settings, sessionStatus]);

  // Contextual upgrade (S12): a Free user clicks a locked platform → show the
  // "Create for {platform}" prompt instead of a generic pricing modal.
  // Loading is not Free: while the session is unresolved every platform
  // looks locked, so a click now must do nothing — otherwise a Creator on a
  // slow first load opens (and persists) an upgrade flow for an entitlement
  // they already own.
  const handlePlatformUpgradeRequired = useCallback((platformId?: PlatformId) => {
    if (sessionStatus === 'loading') return;
    if (platformId) {
      const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
      if (preset) {
        setLockedPlatform(preset);
        // Persist intent so we can restore after payment redirect
        try { window.localStorage.setItem('sxs-upgrade-intent', platformId); } catch {}
        return;
      }
    }
    ui.setIsPricingModalOpen(true);
  }, [sessionStatus, ui]);

  const handleUpgradeFromPrompt = useCallback(() => {
    setLockedPlatform(null);
    if (!session?.user) {
      // Guest: auth first, then pricing after login
      setPendingPricingAfterAuth(true);
      setAuthIntent('register');
      ui.setIsAuthModalOpen(true);
    } else {
      // Free logged-in user: go directly to pricing/checkout
      // Keep upgrade intent in localStorage for closed-loop restoration
      ui.setIsPricingModalOpen(true);
    }
  }, [session?.user, ui]);

  const handlePricingAuthRequired = useCallback(() => {
    setPendingPricingAfterAuth(true);
    ui.setIsPricingModalOpen(false);
    setAuthIntent('register');
    ui.setIsAuthModalOpen(true);
  }, [ui]);

  const handleAuthSuccessWithPricing = useCallback(() => {
    ui.handleAuthSuccess();
    if (pendingPricingAfterAuth) {
      setPendingPricingAfterAuth(false);
      // Reopen pricing after login so the guest can continue checkout with
      // the captured plan preselected.
      setTimeout(() => ui.setIsPricingModalOpen(true), 250);
      showToast('Logged in — continue to checkout');
    }
    // Removed the `else if (checkoutIntent && session?.user)` branch.
    // The pricing modal should only open after sign-in when
    // pendingPricingAfterAuth is set (i.e. the user explicitly triggered
    // a platform upgrade before logging in). Ordinary sign-in should not
    // trigger a payment-completion flow.
  }, [pendingPricingAfterAuth, checkoutIntent, session?.user, ui, showToast]);

  // Capture ?checkout=creator_monthly|creator_yearly (landing page) or localStorage pending plan
  // on initial load. Then, when session becomes authenticated, open the payment form if there's
  // a captured intent. This prevents stale localStorage from triggering payment on every login.
  const intentCapturedRef = useRef(false);
  // Stable identities for the modal openers this effect schedules.
  // `ui` itself is a NEW object on every render (useStudioUI has no
  // memo), so listing it in the deps below made React tear down and
  // re-run this effect on EVERY render: the cleanup cancelled the
  // 400ms timer before it fired, and the re-run skipped re-arming it
  // (intent already captured, ?checkout already scrubbed) — so a
  // guest landing with a checkout intent never saw the auth modal.
  // State setters are referentially stable, so depending on THESE
  // keeps the timer alive across ordinary re-renders.
  const setIsPricingModalOpen = ui.setIsPricingModalOpen;
  const setIsAuthModalOpen = ui.setIsAuthModalOpen;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStatus === 'loading') return;

    // Only capture intent on first load or when a new checkout URL arrives
    const params = new URLSearchParams(window.location.search);
    const q = params.get('checkout');
    const hasCheckoutParam = q === 'creator_monthly' || q === 'creator_yearly';

    if (!intentCapturedRef.current || hasCheckoutParam) {
      let intent: { tier: 'creator'; billingPeriod: 'monthly' | 'yearly' } | null = null;
      try {
        if (hasCheckoutParam) {
          intent = q === 'creator_monthly'
            ? { tier: 'creator', billingPeriod: 'monthly' }
            : { tier: 'creator', billingPeriod: 'yearly' };
        } else {
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
      try { window.localStorage.removeItem('sxs-pending-plan'); } catch {}
      intentCapturedRef.current = true;
      // Capture only — no timers in this effect. React StrictMode (dev)
      // re-runs mount effects and executes the cleanup in between, so a
      // one-shot timer armed here would be cancelled before it fired while
      // the ref/scrub guard above blocks the re-run from re-arming it.
      // The resume effects below open the modals from this persistent state,
      // which is safe under StrictMode and session-revalidation churn.
      if (!session?.user) {
        // Guest with a genuine purchase intent (abandoned Get Creator, or an
        // OAuth return): sign in first — the pricing modal reopens via
        // handleAuthSuccessWithPricing once authentication succeeds.
        setPendingPricingAfterAuth(true);
        setAuthIntent('register');
      }
    }
    // session?.user is read above but deliberately NOT listed as a dep: its
    // object identity changes on every session revalidation, and this effect
    // is one-shot (intentCapturedRef) anyway — the status transition alone
    // re-runs it at every moment that matters.
  }, [sessionStatus]);

  // Authenticated arrival with a captured purchase intent → straight to the
  // payment form. The guard persists across re-runs, so a StrictMode teardown
  // or session-identity change merely re-arms the timer; the shown-ref makes
  // it one-shot so a later revalidation cannot reopen a modal the user closed.
  const checkoutResumeShownRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!checkoutIntent || !session?.user) return;
    if (checkoutResumeShownRef.current) return;
    const t = setTimeout(() => {
      checkoutResumeShownRef.current = true;
      setIsPricingModalOpen(true);
    }, 400);
    return () => clearTimeout(t);
  }, [checkoutIntent, session?.user, setIsPricingModalOpen]);

  // Guest arrival with a captured purchase intent → prompt sign-in first
  // (closed-loop checkout). Same one-shot pattern; if the session becomes
  // authenticated in the meantime the guard fails and the authenticated
  // arrival effect above takes over instead of nagging with a login dialog.
  const checkoutAuthPromptedRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStatus !== 'unauthenticated') return;
    if (!checkoutIntent || !pendingPricingAfterAuth) return;
    if (checkoutAuthPromptedRef.current) return;
    const t = setTimeout(() => {
      checkoutAuthPromptedRef.current = true;
      setIsAuthModalOpen(true);
    }, 400);
    return () => clearTimeout(t);
  }, [sessionStatus, checkoutIntent, pendingPricingAfterAuth, setIsAuthModalOpen]);

  // When session becomes authenticated, open pricing ONLY if there was a genuine
  // pending payment (pendingPricingAfterAuth set from platform upgrade flow),
  // not merely because a checkoutIntent was captured from a prior "Start Creator"
  // click on the landing page. The checkoutIntent capture exists to support the
  // case where a user begins a purchase flow, logs in, and needs to complete it,
  // but it must not fire on ordinary sign-in where no payment is pending.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStatus !== 'authenticated') return;
    if (!pendingPricingAfterAuth) return;
    if (!session?.user) return;

    // Stable setter, not `ui` — see the note above the capture effect: `ui`
    // is a new object every render, so depending on it would cancel this
    // 400ms timer on every re-run before it ever fired.
    const t = setTimeout(() => setIsPricingModalOpen(true), 400);
    return () => clearTimeout(t);
  }, [sessionStatus, pendingPricingAfterAuth, session?.user, setIsPricingModalOpen]);

  // After Google/GitHub auth redirect (page reload), restore the upgrade intent
  // so the user doesn't have to click the locked platform again — unless they
  // are already entitled, in which case a stale intent would nag a Creator
  // with an upgrade prompt on every fresh login. Scrub it instead.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStatus === 'loading' || !session?.user) return;
    try {
      const pendingPlatform = window.localStorage.getItem('sxs-upgrade-intent');
      if (pendingPlatform) {
        const preset = PLATFORM_PRESETS.find((p) => p.id === pendingPlatform);
        // A stale intent must never resurrect an upgrade prompt the user is
        // already entitled to — for a Creator that is every platform, for
        // Free it is the included YouTube 16:9. Scrub instead of showing.
        if (!preset || !isPlatformLockedForUser(preset.id, session.user.plan || 'free')) {
          window.localStorage.removeItem('sxs-upgrade-intent');
          return;
        }
        {
          // User is now authenticated — show the upgrade prompt directly
          const t = setTimeout(() => setLockedPlatform(preset), 400);
          return () => clearTimeout(t);
        }
      }
    } catch {}
  }, [sessionStatus, session?.user, isCreatorUser]);

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
  // Stable identities on purpose: this callback is a dependency of the
  // recording timer, so re-creating it every render re-armed that effect
  // continuously.
  const recorderStop = recorder.stopRecording;
  const cameraStop = camera.stop;
  const handleStopAndReleaseCamera = useCallback(() => {
    recorderStop();
    cameraStop();
    if (captureSource !== 'camera') {
      screenCapture.stop();
      stopScreenMicStream();
    }
  }, [recorderStop, cameraStop, captureSource, screenCapture, stopScreenMicStream]);

  handleScreenStreamEndedRef.current = () => {
    const state = recorder.recordingState;
    if (state === 'recording' || state === 'paused' || state === 'countdown') {
      if (state === 'countdown') {
        recorder.cancelCountdown();
      } else {
        recorderStop();
      }
      showToast('Screen sharing stopped — recording saved.');
    } else {
      showToast('Screen sharing stopped.');
    }
    stopScreenMicStream();
    setCaptureSource('camera');
  };

  const { elapsedSeconds, resetTimer } = useRecordingTimer({
    recordingState: recorder.recordingState,
    stopRecording: handleStopAndReleaseCamera,
    showToast,
    maxDurationSeconds: recordingCap,
    resetOnComplete: false,
  });

  const isRecordingOrPaused = recorder.recordingState === 'recording' || recorder.recordingState === 'paused';
  // Device (re)acquisition is only safe when no take is in flight or being
  // counted down to — same contract the TransportBar's device pickers use.
  const isIdlePreRecord = recorder.recordingState === 'idle' || recorder.recordingState === 'completed';

  // A physical camera/microphone loss is a real capture failure, not a UI
  // toggle. `useCamera` reports it as an error and releases the remaining
  // track; stop the take here so the user reviews the real footage instead of
  // watching a frozen frame under a REC badge. During the countdown, cancel
  // instead of capturing a dead stream.
  const previousCameraStatusRef = useRef(camera.status);
  useEffect(() => {
    const previous = previousCameraStatusRef.current;
    previousCameraStatusRef.current = camera.status;
    if (camera.status !== 'error' || previous !== 'ready') return;

    if (recorder.recordingState === 'countdown') {
      showToast(camera.errorMessage ?? 'Your camera or microphone was disconnected.');
      recorder.cancelCountdown(masterRecordingData ? 'completed' : 'idle');
    } else if (
      recorder.recordingState === 'recording' ||
      recorder.recordingState === 'paused'
    ) {
      showToast(camera.errorMessage ?? 'Your camera or microphone was disconnected.');
      handleStopAndReleaseCamera();
    }
  }, [
    camera.status,
    camera.errorMessage,
    recorder.recordingState,
    recorder.cancelCountdown,
    masterRecordingData,
    handleStopAndReleaseCamera,
    showToast,
  ]);

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
  // Suppressed (hidden behind a screen share) prompter time does not drain the
  // Free allowance: the user cannot read an overlay that is not rendered.
  const teleprompterRemaining = getTeleprompterRemainingInSession(
    teleprompterSessionCap,
    isRecordingOrPaused && teleprompterActive && !isScreenShareActive ? elapsedSeconds : 0,
  );
  const teleprompterDisabled = teleprompterRemaining !== null && teleprompterActive && teleprompterRemaining <= 0;
  const teleprompterRemainingDisplay = isCreatorUser ? null : teleprompterRemaining;
  const teleprompterNotice = isScreenShareActive
    ? 'Screen sharing is active — the teleprompter is hidden until sharing stops.'
    : isCreatorUser
      ? null
      : teleprompterDisabled
        ? `Teleprompter limit reached (3 min per recording on Free). Upgrade to Creator for unlimited.`
        : `Free plan: ${Math.max(1, Math.ceil((teleprompterRemainingDisplay ?? 0) / 60))} min teleprompter for this recording`;

  // Camera on/off — defaults to ON. Toggling disables/enables the video track
  // on the live stream so the mic and the take stay alive while video is off.
  // Initialized to `true` on both server and client to avoid a hydration
  // mismatch; the persisted preference is applied after mount.
  const [isCameraOn, setIsCameraOn] = useState(true);

  // UX-002 (item 5): the ONE condition that decides whether Start is enabled.
  // Extracted from the inline expression at the TransportBar so the blocker
  // message below is derived from exactly the same state that gates the button —
  // the hint can never claim a reason the button does not agree with.
  //
  // Start is enabled by a live stream, OR a camera that was already initialized
  // (Start re-acquires on demand), OR a restored review — and never while a
  // permission request is in flight or while the user has deliberately turned
  // their camera off. A video take with the video track disabled is a black
  // recording, so "off" is a blocker, not a silent capture choice.
  const canStartRecording =
    captureSource === 'camera'
      ? isCameraOn &&
        (!!camera.stream || camera.hasInitialized || isReview) &&
        camera.status !== 'requesting' &&
        camera.status !== 'error'
      : screenCapture.isSupported &&
        screenCapture.status !== 'requesting' &&
        (isReview || !!screenCapture.stream || recorder.recordingState === 'idle');

  const recordBlockerHint = !canStartRecording
    ? captureSource !== 'camera'
      ? !screenCapture.isSupported
        ? 'Screen sharing is not supported in this browser.'
        : screenCapture.status === 'requesting'
          ? 'Choose a screen, window, or tab to share.'
          : screenCapture.errorMessage || 'Share your screen to start recording.'
      : camera.status === 'requesting'
        ? 'Allow camera and microphone access to start recording.'
        : camera.status === 'error'
          ? camera.permissionBlocked
            ? 'Camera or microphone access is blocked. Allow it in your browser settings, then use Retry.'
            : 'Camera or microphone is unavailable. Use Retry on the canvas to try again.'
          : !camera.stream && !camera.hasInitialized
            ? 'Enable Camera & Microphone on the canvas to start recording.'
            : !isCameraOn
              ? 'Turn your camera on to start recording.'
              : 'Enable Camera & Microphone on the canvas to start recording.'
    : captureSource !== 'camera' && !screenCapture.isActive
      ? 'You’ll choose a screen, window, or tab when recording starts.'
      : null;

  // Local UI state
  const isMobile = useMediaQuery('(max-width: 640px)');
  // The side rail + docked inspector need 1280px before they stop squeezing the
  // canvas, so everything below `xl` uses the bottom nav and a drawer inspector.
  // Kept in sync with the `xl` breakpoint used by IconRail/CompactNavMenu/InspectorPanel.
  const isCompactLayout = useMediaQuery('(max-width: 1279px)');
  const [activePanel, setActivePanel] = useState<TabType | 'record' | 'share'>('studio');
  const [freshSessionNeedsCamera, setFreshSessionNeedsCamera] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  // The mute state is pushed onto whatever stream is live AT THE MOMENT of the
  // change — including a stream acquired after the toggle (Stop → Start, a
  // device switch), whose fresh tracks arrive enabled. Without this the button
  // reported "muted" while the recording captured live audio.
  useMicMuteSync(isMicMuted, activeCaptureStream);
  // Apply the persisted camera-on preference after mount so hydration stays
  // consistent (server always renders the camera-ON default).
  useEffect(() => {
    let persisted = true;
    try { persisted = localStorage.getItem('sxs-camera-on') !== 'false'; } catch { /* ignore */ }
    setIsCameraOn(persisted);
    // Disable/enable the video track on the live stream so the mic and take
    // stay alive while video is off. No-op if no stream yet.
    const stream = camera.stream;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.enabled = persisted;
    }
  }, [camera.stream]);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  // Preview as — separate from export platform. Declared up here because
  // "New Video" resets it as part of ending the creation session.
  const [previewPlatformId, setPreviewPlatformId] = useState<PlatformId>(DEFAULT_PLATFORM_ID);

  useEffect(() => {
    if (isCompactLayout) setIsInspectorOpen(false);
  }, [isCompactLayout]);
  // First paint, compact layouts: the drawer starts open (the desktop
  // default) and useMediaQuery only resolves AFTER mount, so below xl it
  // flashed open-then-shut on every load. Closing in the layout phase —
  // before paint — removes the flash. (Layout effect on the server is a
  // no-op warning, hence the guard.)
  const usePrePaintEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  usePrePaintEffect(() => {
    if (window.matchMedia('(max-width: 1279px)').matches) setIsInspectorOpen(false);
  }, []);
  const prompterContainerRef = useRef<HTMLDivElement>(null);

  // Voice speech-follow teleprompter (CR-002): Creator-only, client-side,
  // native SpeechRecognition. `voiceEngagedRef` gates every timed-scroll
  // callback below — while the voice driver owns the position the timed
  // driver idles; all scrolling is incremental, so handing back never jumps.
  const [voiceFollowOn, setVoiceFollowOn] = useState(false);
  const voiceFollow = useVoiceFollow({
    script: scriptStorage.script,
    enabled: voiceFollowOn && canVoiceFollow(userPlan) && !isScreenShareActive,
    muted: isMicMuted,
    paused: recorder.recordingState === 'paused',
    containerRef: prompterContainerRef,
  });
  const { engagedRef: voiceEngagedRef, reset: resetVoiceFollow } = voiceFollow;

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
  // A destructive session transition asks first. One shared dialog (the same
  // one the Library and Export sheet use) instead of window.confirm, so the
  // question is branded, keyboard-trappable and cancelled with Escape.
  const [pendingConfirm, setPendingConfirm] = useState<'new-video' | 'delete-take' | null>(null);

  const startNewVideoSession = useCallback(() => {
    ui.setIsDrawerVisible(false);
    // 'completed' keeps review alive on its own (see isReviewState), so the
    // capture session has to go back to idle or review survives with no take.
    recorder.resetRecording();
    // A finished take has already released its stream, but useCamera remembers
    // that a device was used earlier. Re-arm the first-use prompt so this
    // transition always lands on a usable fresh editor instead of a blank canvas.
    camera.stop();
    setFreshSessionNeedsCamera(true);
    setIsMicMuted(false);
    releaseMasterRecording();
    clearJobs();
    setExportConfig(null);
    setPreviewPlatformId(DEFAULT_PLATFORM_ID);
    setActivePanel('studio');
    // DC-1: a new video starts with an empty script. The outgoing take keeps
    // ITS script in its own row; the editor is a fresh draft area from here.
    scriptStorage.clearScript();
  }, [ui, recorder, camera.stop, releaseMasterRecording, clearJobs, setExportConfig, setPreviewPlatformId, setActivePanel, scriptStorage.clearScript]);

  const discardSessionTake = useCallback(() => {
    ui.setIsDrawerVisible(false);
    recorder.resetRecording();
    clearMasterRecording();
    clearJobs();
    setExportConfig(null);
  }, [ui, recorder, clearMasterRecording, clearJobs, setExportConfig]);

  // Deleting a take ends that video session completely. Do not leave its
  // script in the editor, where the empty recorder screen looks like a failed
  // transition instead of a fresh video workspace.
  const deleteTakeAndStartFreshSession = useCallback(() => {
    discardSessionTake();
    // Deleting the take ends the old capture session. Release any remaining
    // device tracks and show the same first-use prompt as a fresh Studio visit.
    camera.stop();
    setFreshSessionNeedsCamera(true);
    setIsMicMuted(false);
    setPreviewPlatformId(DEFAULT_PLATFORM_ID);
    setActivePanel('studio');
    scriptStorage.clearScript();
  }, [discardSessionTake, camera.stop, setPreviewPlatformId, setActivePanel, scriptStorage.clearScript]);

  const handleCameraPermissionRequest = useCallback(async () => {
    const stream = await handleCameraInitialize();
    if (stream) setFreshSessionNeedsCamera(false);
  }, [handleCameraInitialize]);

  // Entering Screen + Webcam needs the camera for the floating overlay (and
  // the mic). Acquire it as soon as the mode is chosen so the composition and
  // device picking are ready before Record; a denial is recoverable — Record
  // then proceeds screen-only with a toast (see handleRecordStart).
  const cameraInitRequestedRef = useRef(false);
  useEffect(() => {
    if (captureSource !== 'screen-camera') {
      cameraInitRequestedRef.current = false;
      return;
    }
    if (camera.hasInitialized || camera.status === 'requesting') return;
    if (cameraInitRequestedRef.current) return;
    cameraInitRequestedRef.current = true;
    void handleCameraPermissionRequest();
  }, [captureSource, camera.hasInitialized, camera.status, handleCameraPermissionRequest]);

  const handleNewVideo = useCallback(() => {
    // Never destroy a take in flight. New Video is a "start over" for an
    // IDLE session; during a countdown/recording it would silently discard
    // what the camera just captured, so it says so instead.
    if (
      recorder.recordingState === 'countdown' ||
      recorder.recordingState === 'recording' ||
      recorder.recordingState === 'paused'
    ) {
      showToast('Stop the recording first — New Video would discard this take.');
      return;
    }
    // An unsaved script DRAFT (no take to carry its snapshot) would be lost
    // without a word. Once a take exists its script lives in the master's
    // row, so no confirmation is needed there.
    if (!masterRecordingData && scriptStorage.script.trim()) {
      setPendingConfirm('new-video');
      return;
    }
    startNewVideoSession();
  }, [recorder.recordingState, masterRecordingData, scriptStorage.script, showToast, startNewVideoSession]);

  // Restore the master recording from IndexedDB. This is the only thing that
  // carries a take across a cross-document navigation (Google OAuth, the
  // Paddle redirect, the return trip, a reload), so it runs for every
  // session — the hook makes it one attempt per document and refuses to
  // resurrect a take the user explicitly discarded or left behind via New Video.
  useEffect(() => {
    if (!masterRecordingData) {
      restoreMasterRecording();
    }
  }, [masterRecordingData, restoreMasterRecording]);

  // Interrupted-take recovery (Phase 9). If the previous document crashed /
  // was refreshed / was killed while a take was recording, its chunks are
  // still in local recovery storage. Once, per document: sweep expired
  // debris, reassemble the latest recoverable session (if any) and attach it
  // exactly like a freshly finished take. A take that is already held (a
  // restore beat it, or the user recorded) is never overwritten — the
  // recovered session stays in storage until its TTL.
  const recoveryAdoptedRef = useRef(false);
  const masterRecordingRef = useRef<MasterRecording | null>(masterRecordingData);
  masterRecordingRef.current = masterRecordingData;
  // Recovered takes join the 24h master-recording library TTL.
  const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
  useEffect(() => {
    if (!hydrated || recoveryAdoptedRef.current) return;
    recoveryAdoptedRef.current = true;
    const recover = async () => {
      void sweepAbandonedSessions(recoverySink.getSessionId());
      const session = await findRecoverableSession();
      if (!session || masterRecordingRef.current) return;
      // A previous document may have saved this recovery under its session id
      // but been killed before deleting the chunks. Re-adopting it would
      // charge the Free budget twice and surface a duplicate take.
      const alreadyAdopted = await getRecording(session.sessionId);
      if (alreadyAdopted) {
        void deleteChunkSession(session.sessionId);
        return;
      }
      const take = await assembleRecoveryBlob(session);
      if (!take || masterRecordingRef.current) return;
      // The take joins the library as a REAL row and is attached through the
      // Workflow-B machinery (openStoredRecording): after a reload there is no
      // in-flight take to reach the 'completed' state createMasterRecording's
      // review contract expects, so an interrupted take reviews exactly like
      // an opened library recording (isRestored) — which it now is.
      const storedFromRecovery: StoredRecording = {
        id: take.sessionId,
        name: 'Recovered recording',
        blob: take.blob,
        mimeType: take.mimeType,
        extension: take.extension,
        duration: take.duration,
        hasAudio: take.hasAudio,
        recordingMetadata: take.recordingMetadata,
        width: take.width,
        height: take.height,
        aspectRatio: deriveAspectRatioLabel(take.width, take.height),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + RECOVERY_TTL_MS).toISOString(),
        script: scriptStorage.script ?? undefined,
      };
      let saved = true;
      try {
        await saveRecording(storedFromRecovery);
      } catch {
        saved = false;
      }
      // Free-plan honesty: this take DID record, so it consumes the daily
      // budget the normal completion path would have charged at its stop —
      // but only once the library row exists. A failed adoption is retried by
      // the next document and must not be charged again if that retry works.
      if (saved && !isCreatorUser && take.duration > 0) {
        addDailyRecordingSeconds(take.duration);
      }
      openStoredRecording(storedFromRecovery);
      if (saved) {
        // Adoption succeeded: the recovery rows have served their purpose.
        void deleteChunkSession(take.sessionId);
        showToast('Your previous recording was recovered.');
      } else {
        // Keep the rows for the retry, and do not pretend the library copy
        // exists — it does not.
        showToast('Your previous recording is ready here, but we could not save it to your library. Keep this tab open to export it.');
      }
    };
    void recover();
    // The late-value guard reads masterRecordingRef.current at await time, so
    // this effect intentionally runs once (per document) instead of on master
    // changes.
  }, [hydrated, recoveryAdoptedRef, recoverySink, openStoredRecording, showToast, isCreatorUser, masterRecordingRef, scriptStorage.script]);

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

        // A take that lasted less than a second still becomes a library row
        // that reads 00:00. Nothing downstream will warn, so the take says it
        // itself while Review is on screen and "Retake" is one click away.
        const warnIfSubSecond = (duration: number) => {
          if (Number.isFinite(duration) && duration < 1) {
            showToast('That take is under a second — retake before exporting.');
          }
        };

        videoEl.onloadedmetadata = () => {
          const actualWidth = videoEl.videoWidth || result.width || recordingConfig.width;
          const actualHeight = videoEl.videoHeight || result.height || recordingConfig.height;
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
            scriptSnapshot,
            {
              ...result.metadata,
              duration: mediaDuration,
              fileSize: result.blob.size,
              averageFileBitrate: mediaDuration > 0 ? Math.round((result.blob.size * 8) / mediaDuration) : null,
            }
          );
          warnIfSubSecond(mediaDuration);
        };

        videoEl.onerror = () => {
          cleanupProbe();
          // Fall back to the capture track's real settings (never a target
          // nobody delivered), then the configured target.
          createMasterRecording(
            result.blob,
            result.duration,
            result.hasAudio,
            result.width || recordingConfig.width,
            result.height || recordingConfig.height,
            scriptSnapshot,
            result.metadata
          );
          warnIfSubSecond(result.duration);
        };
      }

    resetTimer();
  }, [recorder.recordingState, recorder.recordingResult, createMasterRecording, recordingConfig.width, recordingConfig.height, isCreatorUser, setDrawerVisible, resetTimer, scriptStorage.script, showToast]);

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

  // The teleprompter driver pair, shared by Start, keyboard Resume and the
  // TransportBar Resume (previously three copies — two of which drifted).
  // Scroll advances by ELAPSED time, not a fixed per-tick increment: when a
  // backgrounded tab clamps intervals to ≥1s, the prompter keeps its
  // configured px/second average instead of nearly freezing.
  const liveScrollSettings = useRef(settings.teleprompter);
  useEffect(() => {
    liveScrollSettings.current = settings.teleprompter;
  }, [settings.teleprompter]);

  const buildScrollAndCheckEnd = useCallback(() => ({
    scrollCallback: (elapsedMs: number) => {
      if (voiceEngagedRef.current) return;
      if (!prompterContainerRef.current) return;
      const container = prompterContainerRef.current;
      // Historic behavior: (speed/20) * multiplier px per 50ms tick.
      const { scrollSpeed, scrollSpeedMultiplier } = liveScrollSettings.current;
      const pxPerMs = (scrollSpeed / 20) * scrollSpeedMultiplier / 50;
      container.scrollTop += Math.max(0, pxPerMs * elapsedMs);
    },
    checkEndCallback: (): boolean => {
      if (!prompterContainerRef.current) return false;
      const container = prompterContainerRef.current;
      const scrolledHeight = container.scrollTop + container.clientHeight;
      const scrollableHeight = container.scrollHeight;
      return scrolledHeight >= scrollableHeight - 5;
    },
  }), [voiceEngagedRef]);

  const ensureScreenMicStream = useCallback(async (): Promise<MediaStream | null> => {
    const existing = screenMicStreamRef.current;
    if (existing && existing.getAudioTracks().some((t) => t.readyState === 'live')) return existing;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: buildPreferredAudioConstraints(settings.selectedAudioDevice),
        video: false,
      });
      screenMicStreamRef.current = mic;
      setScreenMicStream(mic);
      return mic;
    } catch {
      return null;
    }
  }, [settings.selectedAudioDevice]);

  const handleRecordStart = useCallback(async () => {
    if (!isCreatorUser && !canRecordToday()) {
      showToast('Your device-local Free recording allowance is used for today. Come back tomorrow, or upgrade to Creator for unlimited recording.');
      return;
    }

    recorder.resetRecording();
    resetTimer();
    resetVoiceFollow();

    let liveStream = null;
    if (captureSource === 'screen-camera') {
      let displayStream = screenCapture.stream;
      if (!displayStream || displayStream.getVideoTracks().length === 0) {
        displayStream = await screenCapture.start();
      }
      if (!displayStream) {
        showToast(screenCapture.errorMessage ?? 'Screen sharing was cancelled.');
        return;
      }
      const screenVideo = displayStream.getVideoTracks()[0];
      if (!screenVideo) {
        showToast('No screen video was available. Try sharing again.');
        return;
      }

      // The webcam overlay needs the camera. A denial or failure here is NOT
      // fatal — the take proceeds screen-only (with the mic if any) and says
      // so, instead of losing the share the user just picked.
      let webcamStream = camera.stream;
      if (!webcamStream || webcamStream.getVideoTracks().length === 0) {
        webcamStream = await handleCameraInitialize();
      }
      if (!webcamStream || webcamStream.getVideoTracks().length === 0) {
        showToast('Camera unavailable — recording your screen without the webcam.');
      } else if (!isCameraOn) {
        setIsCameraOn(true);
        try { localStorage.setItem('sxs-camera-on', 'true'); } catch { /* ignore */ }
        const videoTrack = webcamStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = true;
        showToast('Camera turned on for your retake.');
      }

      // Composition is the recorder input: the composed stream is built from
      // the FRESHEST stream objects (React may not have re-rendered yet).
      const composed = await composition.ensureReady({
        screenStream: displayStream,
        cameraStream: webcamStream,
      });
      if (!composed) {
        showToast('Could not compose the screen recording. Try sharing again.');
        return;
      }
      liveStream = composed;
    } else if (captureSource === 'screen') {
      let displayStream = screenCapture.stream;
      if (!displayStream || displayStream.getVideoTracks().length === 0) {
        displayStream = await screenCapture.start();
      }
      if (!displayStream) {
        showToast(screenCapture.errorMessage ?? 'Screen sharing was cancelled.');
        return;
      }
      const screenVideo = displayStream.getVideoTracks()[0];
      if (!screenVideo) {
        showToast('No screen video was available. Try sharing again.');
        return;
      }
      // Preserve any audio the user opted to share (e.g. tab audio), then
      // add microphone narration. Mic is preferred from an existing camera
      // stream to avoid an extra permission prompt.
      const displayAudioTracks = displayStream.getAudioTracks().filter((t) => t.readyState === 'live');
      let micTracks = camera.stream?.getAudioTracks().filter((t) => t.readyState === 'live') ?? [];
      if (micTracks.length === 0) {
        const micStream = await ensureScreenMicStream();
        micTracks = micStream?.getAudioTracks().filter((t) => t.readyState === 'live') ?? [];
      }
      // Avoid duplicating the same track if it appears in both sources.
      const seenTrackIds = new Set<string>();
      const mergedAudio = [...displayAudioTracks, ...micTracks].filter((t) => {
        if (seenTrackIds.has(t.id)) return false;
        seenTrackIds.add(t.id);
        return true;
      });
      liveStream = new MediaStream([screenVideo, ...mergedAudio]);
    } else {
      liveStream = camera.stream;
      if (!liveStream) {
        if (!camera.hasInitialized && !isReview) return;
        liveStream = await handleCameraInitialize();
        if (!liveStream) {
          showToast("Couldn't start the camera. Check permissions and try again.");
          return;
        }
      }
      if (!isCameraOn) {
        setIsCameraOn(true);
        try { localStorage.setItem('sxs-camera-on', 'true'); } catch { /* ignore */ }
        showToast('Camera turned on for your retake.');
      }
    }

    // Real preflight (Phase 12): only checks already proven by this point
    // (codec support, live tracks, storage/policy warnings) — it adds no
    // device probing. A fatal issue stops the click loudly; a warning (e.g.
    // storage nearly full) is surfaced and recording proceeds.
    const preflight = await runRecordingPreflight({ stream: liveStream });
    const fatalIssue = preflight.issues.find((issue) => issue.severity === 'fatal');
    if (fatalIssue) {
      showToast(fatalIssue.message);
      return;
    }
    for (const issue of preflight.issues) {
      if (issue.severity === 'warning') showToast(issue.message);
    }

    const { scrollCallback, checkEndCallback } = buildScrollAndCheckEnd();
    recorder.startRecording(scrollCallback, checkEndCallback, liveStream, {
      countdown: settings.countdownEnabled,
      onScriptEnd: () => showToast('Script ended — recording stopped'),
      onError: (message: string) => showToast(message),
      recovery: recoverySink,
    });
  }, [captureSource, camera.stream, camera.hasInitialized, composition, ensureScreenMicStream, handleCameraInitialize, isCameraOn, isCreatorUser, isReview, recorder, recoverySink, resetTimer, resetVoiceFollow, screenCapture, settings.countdownEnabled, showToast, buildScrollAndCheckEnd]);

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
  //   It deletes the only copy of the bytes, so it says so first — the Export
  //   sheet raises the shared ConfirmDialog (gated by
  //   `practiceAgainDiscardsTake`) and only calls this once the user agrees.
  //   This handler therefore performs the discard it is asked to perform;
  //   nothing else calls it.
  const handlePracticeAgain = useCallback(() => {
    if (isLibraryOriginal) {
      handleNewVideo();
      return;
    }
    discardSessionTake();
  }, [isLibraryOriginal, handleNewVideo, discardSessionTake]);

  // Review → Retake. This is deliberately NON-destructive: the take on screen
  // is already a library row, so starting another take leaves it there and
  // creates a new row when the next take stops. That is different from the
  // export-success "Record Again", which confirms a discard. The review copy
  // says which one is happening so the user never has to guess.
  const handleReviewRetake = useCallback(() => {
    ui.setIsDrawerVisible(false);
    // A take can be stopped while the camera is off (the toggle stays live
    // mid-take). Review hides the live device chips, so there would be no way
    // to switch it back on before a new take. Retake means "record again with
    // the camera", so restore it rather than starting a black take under a
    // Camera-off overlay.
    if (!isCameraOn) {
      setIsCameraOn(true);
      try { localStorage.setItem('sxs-camera-on', 'true'); } catch { /* ignore */ }
      showToast('Camera turned on for your retake.');
    }
    void handleRecordStart();
  }, [ui, handleRecordStart, isCameraOn, showToast]);

  // Review → Delete. Only a take created in this session may be destroyed
  // from here. A library original (or a recovered take, which is adopted as
  // one) is the user's existing video and is deleted from the Library, where
  // that consequence is explicit — never as a side effect of review.
  const handleReviewDelete = useCallback(() => {
    if (!masterRecordingData || isLibraryOriginal) return;
    setPendingConfirm('delete-take');
  }, [masterRecordingData, isLibraryOriginal]);

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

  const handleCameraToggle = useCallback(() => {
    setIsCameraOn((prev) => {
      const next = !prev;
      try { localStorage.setItem('sxs-camera-on', String(next)); } catch { /* ignore */ }
      // Disable/enable the video track on the live stream so the mic and take
      // stay alive while video is off. No-op if no stream yet.
      const stream = camera.stream;
      if (stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = next;
      }
      return next;
    });
  }, [camera.stream]);

  // DC-3 / UX-001 — ONE meaning for every label, at every breakpoint:
  //
  //   "Studio"     -> navigation. It goes to the Studio view and does nothing
  //                   else. It used to run the full session reset here, so a
  //                   rail item that looked like navigation silently cleared
  //                   the current take, while the compact nav's equivalent tab
  //                   (already a pure switch) behaved differently from it.
  //   "New Video"  -> the explicit start-over action, present in BOTH rails.
  //
  // Both navs now share this one handler, so the same label cannot drift into
  // meaning two things again. The rail owns its own "New Video" entry
  // (onNewVideo), which is where the reset belongs: it detaches the take into
  // the library and never deletes it.
  const handleCompactNav = useCallback((panel: TabType | 'record' | 'share') => {
    setActivePanel(panel);
  }, []);

  const isStudio = activePanel === 'studio';

  // Capture keeps live teleprompter settings accessible; the inspector itself
  // locks controls that must wait until the take has finished.
  const handleToggleInspector = useCallback(() => {
    // After capture, settings belong to the saved take's export workflow.
    if (isReview) {
      setDrawerVisible(true);
      return;
    }
    if (!isStudio) {
      setActivePanel('studio');
      setIsInspectorOpen(true);
      return;
    }
    setIsInspectorOpen((prev) => !prev);
  }, [isReview, isStudio, setDrawerVisible]);

  const handleShowShortcuts = useCallback(() => {
    showToast('Space: Start / Stop recording · P: Pause / Resume · M: Mute microphone · ↑ ↓: Move text · Esc: Close');
  }, [showToast]);

  // (checkout intent effect above handles search cleanup)

  useKeyboardShortcuts({
    onRecordStop: handleRecordStop,
    onRecordPause: recorder.pauseRecording,
    onRecordResume: () => {
      const { scrollCallback, checkEndCallback } = buildScrollAndCheckEnd();
      recorder.resumeRecording(scrollCallback, checkEndCallback);
    },
    onMicToggle: handleMicToggle,
    onNudgeUp: handleNudgeUp,
    onNudgeDown: handleNudgeDown,
    onCloseDrawer: handleDismissDrawer,
    isRecording: recorder.recordingState === 'recording',
    isPaused: recorder.recordingState === 'paused',
    canRecord: canStartRecording,
    isDrawerVisible: ui.isDrawerVisible,
    canNudge: prompterScript.length > 0,
  });

  // Single authority for review playback: the take may be audible only while
  // the review surface itself owns the user's attention. Pricing, upgrade,
  // auth, and activation modals all render above review — opening any of
  // them pauses, closing resumes from the same position (Canvas preserves
  // currentTime; only a new recording URL restarts).
  const isBlockingModalOpen =
    ui.isPricingModalOpen ||
    ui.isAuthModalOpen ||
    welcomeModal.isVisible ||
    lockedPlatform !== null;

  // The delete/new-video confirmation is a blocking question too: the take
  // must not keep playing (with sound) behind the decision about its fate.
  const reviewPlaybackSuppressed = isBlockingModalOpen || pendingConfirm !== null;

  // z-drawer (150) renders above z-modal (100), so the compact-layout
  // inspector drawer left open would sit ON TOP of any blocking modal —
  // covering the very surface the user just asked for. Every blocking modal
  // therefore dismisses the drawer; the docked (xl) inspector is in normal
  // flow and needs no such handling.
  useEffect(() => {
    if (isBlockingModalOpen && isCompactLayout) setIsInspectorOpen(false);
  }, [isBlockingModalOpen, isCompactLayout]);

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

  // Dimension truth is used by the RecordingStatusLine while a take is in
  // flight: the ACTUAL MediaStream track settings, never a configured target
  // dressed up as capture. For screen-family sources this is the screen /
  // composed track's real geometry, not the camera's.
  const liveCaptureInfo = readTrackCaptureInfo(
    captureSource === 'camera'
      ? camera.stream
      : composition.composedStream ?? screenCapture.stream,
  );

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
    screenShareActive: isScreenShareActive,
    script: scriptStorage.script,
    onScriptChange: scriptStorage.setScript,
    onClearScript: scriptStorage.clearScript,
    wordCount: scriptStorage.wordCount,
    progress: scriptStorage.progress,
    onLoadInspiration: scriptStorage.loadInspiration,
    voiceFollow: {
      visible: voiceFollow.supported && canVoiceFollow(userPlan) && !isScreenShareActive,
      enabled: voiceFollowOn,
      onChange: setVoiceFollowOn,
      phase: voiceFollow.phase,
    },
  };

  const pendingConfirmCopy = pendingConfirm === 'delete-take'
    ? {
        title: 'Delete this recording?',
        message: 'It will be removed from this browser and cannot be undone.',
        confirmLabel: 'Delete recording',
        cancelLabel: 'Keep recording',
      }
    : {
        title: 'Start a new video?',
        message: 'Your unsaved script draft will be cleared. This cannot be undone.',
        confirmLabel: 'Start new video',
        cancelLabel: 'Keep editing',
      };

  return (
    <>
      <WelcomeModal
        isVisible={welcomeModal.isVisible}
        dontShowAgain={welcomeModal.dontShowAgain}
        onDontShowChange={welcomeModal.setDontShowAgain}
        onGetStarted={() => {
          welcomeModal.closeModal();
          if (!camera.isInitialized) handleCameraPermissionRequest();
        }}
        onExploreStudio={welcomeModal.closeModal}
      />

      {/* The export sheet is modal in every respect, so its background must be
          inert as well as visually dimmed: without it the header/nav/main stayed
          focusable and clickable behind the backdrop. The sheet itself renders
          outside this shell, so it is unaffected. */}
      <div
        className="studio-shell flex flex-col bg-canvas overflow-hidden"
        inert={ui.isDrawerVisible || undefined}
      >
        <Header
          hasRecording={isReview && !!masterRecordingData}
          onExport={() => ui.setIsDrawerVisible(true)}
          onShare={share}
          onToggleInspector={handleToggleInspector}
          isInspectorOpen={isReview ? ui.isDrawerVisible : isInspectorOpen}
          onSignIn={() => {
            setAuthIntent('login');
            ui.handleAuthRequired();
          }}
          userPlan={userPlan}
          onPricingClick={handlePricingClick}
          compactNav={
            <CompactNavMenu
              activePanel={activePanel}
              onPanelChange={handleCompactNav}
              onNewVideo={handleNewVideo}
              onSettingsToggle={handleToggleInspector}
            />
          }
        />

        {/* Compact layouts no longer pin a navigation bar to the bottom of the
            viewport: those destinations now live behind the hamburger in the
            app bar above. The row keeps no bottom reservation, so the canvas
            and the transport reclaim the 3.5rem they used to pay for it. */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <IconRail
            activePanel={activePanel}
            onPanelChange={handleCompactNav}
            onNewVideo={handleNewVideo}
            onShowShortcuts={handleShowShortcuts}
          />

          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" role="main">
            <div className={`relative flex-1 min-h-0 flex flex-col overflow-hidden ${isStudio ? '' : 'hidden'}`}>
              {/* Recording-format line: the one pre-record choice that changes
                  what the CAMERA captures. A single quiet line above the
                  canvas — the device selections that used to share this row
                  moved behind the mic / camera chevrons in the transport.
                  IMPORTANT: the row reserves its height for the WHOLE studio
                  session (contents hide during a take) so starting or stopping
                  never reflows the canvas — no layout jump. */}
              <div className="w-full flex items-center justify-center min-h-11 px-3 py-0.5 shrink-0 overflow-hidden">
                {!isReview && recorder.recordingState !== 'countdown' && recorder.recordingState !== 'recording' && recorder.recordingState !== 'paused' && (
                  <RecordingFormatPicker
                    recordingPlatformId={settings.platformId}
                    onSelect={(id) => settings.setPlatformId(id)}
                    userPlan={session?.user?.plan || 'free'}
                    onUpgradeRequired={(id) => handlePlatformUpgradeRequired(id)}
                  />
                )}
              </div>
              {/* The capture session is 'completed' from the instant the
                  recorder finishes until the async metadata probe + master
                  create land (and a restored take can arrive the same way):
                  in that gap isReview is true but there is no take to draw
                  yet. Without this the canvas showed a black frame with no
                  explanation. */}
              {isReview && !masterRecordingData && (
                <div
                  role="status"
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-canvas/80 backdrop-blur-sm"
                >
                  <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <span className="text-[12px] font-medium text-text-secondary">Finishing your recording…</span>
                </div>
              )}

              {!isCreatorUser && isMobile && (
                // Keep the row reserved in review too: hiding it would hand
                // its height back to the canvas at Stop and shift the frame.
                <FreeRotateNudge suppressed={isReview || recorder.recordingState !== 'idle'} />
              )}

              <div className="flex flex-1 min-h-0 min-w-0 flex-col lg:flex-row">
              <div className="flex flex-1 min-h-0 min-w-0 flex-col">
              <Canvas
                focusViewEnabled={focusView.isEnabled}
                onFocusViewToggle={focusView.toggle}
                aspectRatio={isReview ? previewPreset.aspectRatio : settings.aspectRatio}
                reviewVideoUrl={isReview && masterRecordingData ? masterRecordingData.url : undefined}
                reviewAspectRatio={isReview ? previewPreset.aspectRatio : undefined}
                reviewVideoStyle={reviewCropStyle}
                reviewDuration={isReview && masterRecordingData ? masterRecordingData.duration : undefined}
                reviewHasAudio={isReview && masterRecordingData ? masterRecordingData.hasAudio : false}
                reviewActive={isReview && isStudio && !ui.isDrawerVisible && !reviewPlaybackSuppressed}
                statusBadge={<RecordingBadge recordingState={recorder.recordingState} />}
              >
                {captureSource === 'screen-camera' ? (
                  <ScreenWebcamPreview
                    canvasEl={composition.canvasEl}
                    overlay={settings.webcamOverlay}
                    onOverlayChange={settings.setWebcamOverlay}
                    cameraAspect={cameraAspect}
                    screenActive={screenCapture.isActive}
                  />
                ) : (
                  <CameraPreview
                    stream={captureSource === 'screen' ? screenCapture.stream : camera.stream}
                    isMirrored={captureSource === 'camera' ? settings.isMirrored : false}
                    focusViewEnabled={focusView.isEnabled}
                    objectFit={captureSource === 'screen' ? 'contain' : 'cover'}
                  />
                )}

                {/* Camera-off state: an honest overlay over the frozen frame.
                    Only when the capture session exists AND the user turned
                    the video track off — never a fake stream, and it disappears
                    the instant the track is live again. */}
                {captureSource !== 'screen' && !isReview && camera.hasInitialized && camera.status !== 'error' && camera.stream && !isCameraOn && (
                  <CameraOffOverlay onEnable={handleCameraToggle} isMicMuted={isMicMuted} />
                )}
                {captureSource !== 'screen' && !isReview && !isCameraOn && !camera.hasInitialized && camera.status === 'idle' && (
                  <CameraOffOverlay onEnable={handleCameraToggle} isMicMuted={isMicMuted} />
                )}

                {captureSource !== 'camera' && !screenCapture.stream && !isReview && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
                    <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border-default bg-surface/95 p-6 text-center shadow-2xl">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
                        <ScreenShareIcon className="h-7 w-7" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[15px] font-semibold text-text-primary">Share your screen</p>
                        <p className="text-[13px] leading-relaxed text-text-secondary">
                          Choose an entire screen, window, or browser tab in the browser picker. Your screen will appear here before you record.
                        </p>
                      </div>
                      {screenCapture.errorMessage && (
                        <p className="w-full rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
                          {screenCapture.errorMessage}
                        </p>
                      )}
                      {captureSource === 'screen-camera' && camera.status === 'error' && camera.errorMessage && (
                        <p className="w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
                          {camera.errorMessage}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => { void screenCapture.start(); }}
                        disabled={!screenCapture.isSupported || screenCapture.status === 'requesting'}
                        className="min-h-[44px] rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {screenCapture.status === 'requesting' ? 'Waiting for selection…' : 'Share screen'}
                      </button>
                      {!screenCapture.isSupported && (
                        <p className="text-[12px] text-text-tertiary">
                          Screen sharing is not supported in this browser.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {teleprompterDisabled && !isScreenShareActive ? (
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
                ) : prompterScript && !isScreenShareActive ? (
                  <TeleprompterOverlay
                    ref={prompterContainerRef}
                    script={scriptStorage.script}
                    settings={settings.teleprompter}
                  />
                ) : null}

                <FocalGuideway position={settings.teleprompter.textStartPosition} />

                {/* Phase 13 status line: real capture geometry + the real
                    state of the local recovery copy, only while a take or
                    countdown is in flight. */}
                {(recorder.recordingState === 'recording' || recorder.recordingState === 'paused' || recorder.recordingState === 'countdown') && (
                  <RecordingStatusLine
                    capture={liveCaptureInfo && recorder.recordingState !== 'countdown'
                      ? { width: liveCaptureInfo.width, height: liveCaptureInfo.height, frameRate: liveCaptureInfo.frameRate || undefined }
                      : null}
                    backupState={recorder.recordingState === 'countdown' ? 'inactive' : backupState}
                  />
                )}

                {/* CR-002: while voice follow is engaged but blocked
                    (permission denied / fatal recognition error) the
                    position stays frozen on purpose — this is the explicit
                    "switch back to timed scroll" affordance. Incremental
                    scrolling means resuming timed mode never jumps. */}
                {voiceFollow.phase === 'blocked' && (
                  <button
                    onClick={() => setVoiceFollowOn(false)}
                    className="absolute top-24 left-2 sm:top-28 sm:left-3 z-20 min-h-[40px] px-3 py-2 rounded-lg bg-surface/95 border border-border-default text-[12px] font-semibold text-text-secondary shadow-lg transition-colors hover:bg-elevated"
                  >
                    Voice follow unavailable — use timed scroll
                  </button>
                )}

                <Timer
                  isRunning={recorder.recordingState === 'recording'}
                  isPaused={recorder.recordingState === 'paused'}
                  elapsedSeconds={elapsedSeconds}
                />

                <CountdownOverlay
                  countdownText={recorder.countdownText}
                  // The state itself is the truth: `countdown` is only ever
                  // entered when the countdown setting is on (FC-1.0).
                  isVisible={recorder.recordingState === 'countdown'}
                  // A countdown started over an existing take (review →
                  // Record again) must fall BACK to review when cancelled —
                  // 'idle' would exit review and hide a take the user still
                  // has. Fresh session: idle, as before.
                  onCancel={() =>
                    recorder.cancelCountdown(masterRecordingData ? 'completed' : 'idle')
                  }
                />

                {/* Shown before first enable AND after a failure/disconnect so
                    Retry is always the visible recovery. Never during an
                    active capture: the user must keep seeing (and reaching)
                    Stop — the overlay returns the moment the take ends. In
                    Screen + Webcam a DENIED camera must not wall off the
                    screen-share card (Record proceeds screen-only), so the
                    fullscreen overlay yields there and the camera error is
                    shown inside the share card instead. */}
                {!camera.isInitialized &&
                  (freshSessionNeedsCamera || !camera.hasInitialized || camera.status === 'error') &&
                  recorder.recordingState !== 'recording' &&
                  recorder.recordingState !== 'paused' &&
                  !(captureSource === 'screen-camera' && camera.status === 'error') && (
                  <InitOverlay
                    onInitialize={handleCameraPermissionRequest}
                    status={camera.status === 'ready' ? 'idle' : camera.status}
                    errorMessage={camera.errorMessage}
                    permissionBlocked={camera.permissionBlocked}
                  />
                )}
              </Canvas>

              {/* Screen-share tools live OUTSIDE the platform frame: this tray
                  sits below the canvas on every platform format and viewport,
                  so no control ever covers the recorded pixels. It stays
                  mounted for the whole capture session (the toolbar is
                  DOM-only chrome; the idle-only share actions join the pill
                  behind a divider, so the row height never changes when a
                  take starts or stops) and only unmounts on review or when
                  leaving a screen capture mode. */}
              {(captureSource === 'screen-camera' || captureSource === 'screen') && !isReview && (
                <div className="shrink-0 w-full px-3 pb-2">
                  {captureSource === 'screen-camera' ? (
                    <WebcamToolbar
                      overlay={settings.webcamOverlay}
                      onOverlayChange={settings.setWebcamOverlay}
                      canvasAspect={
                        composition.canvasEl && composition.canvasEl.width > 0
                          ? composition.canvasEl.width / composition.canvasEl.height
                          : FALLBACK_CANVAS_WIDTH / FALLBACK_CANVAS_HEIGHT
                      }
                      cameraAspect={cameraAspect}
                      isCameraOn={isCameraOn}
                      onCameraToggle={handleCameraToggle}
                      videoDevices={camera.videoDevices}
                      selectedVideoDevice={settings.selectedVideoDevice}
                      onVideoDeviceChange={handleVideoDeviceChange}
                      deviceChangeLocked={!isIdlePreRecord}
                      showShareActions={!!screenCapture.stream && recorder.recordingState === 'idle'}
                      onChangeSource={() => { void screenCapture.start(); }}
                      onStopSharing={() => screenCapture.stop()}
                    />
                  ) : (
                    !!screenCapture.stream && recorder.recordingState === 'idle' && (
                      <div className="flex w-full justify-center">
                        <div className="flex items-center gap-0.5 rounded-2xl border border-border-default bg-surface/95 p-1 shadow-2xl">
                          <ScreenShareActions
                            onChangeSource={() => { void screenCapture.start(); }}
                            onStopSharing={() => screenCapture.stop()}
                          />
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
              </div>

              {/* Review controls occupy their own space so the entire platform
                  frame and playback controls remain visible at every size. */}
              {isReview && masterRecordingData && (
                <div
                  ref={reviewTrayRef}
                  data-review-tray
                  role="region"
                  aria-label="Recording ready. Review your recording."
                  tabIndex={-1}
                  className="shrink-0 max-h-[45%] overflow-y-auto border-t border-border-default bg-surface lg:max-h-none lg:w-64 lg:border-t-0 lg:border-l focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <div className="p-3 lg:p-4">
                    <div className="mx-auto flex max-w-5xl flex-col gap-2 lg:gap-4">
                      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                        <span className="text-[12px] font-semibold text-text-primary">
                          Your recording is ready.
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-text-secondary">
                          {formatTime(masterRecordingData.duration)}
                        </span>
                        <span aria-hidden="true" className="text-[11px] text-text-muted">·</span>
                        <span className="text-[11px] text-text-muted">Saved in this browser</span>
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-2 lg:flex-col lg:items-stretch">
                        {!isLibraryOriginal && (
                          <button
                            type="button"
                            onClick={handleReviewDelete}
                            aria-label="Delete recording"
                            title="Delete this take"
                            className="flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-3 rounded-lg text-error/80 ring-1 ring-error/20 hover:text-error hover:bg-error/10 hover:ring-error/40 transition-colors"
                          >
                            <TrashIcon className="w-5 h-5" aria-hidden="true" />
                            <span className="hidden sm:inline text-[12px] font-medium">Delete</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleReviewRetake}
                          aria-label="Retake"
                          aria-describedby="review-retake-note"
                          className="flex flex-col items-center justify-center min-h-[44px] px-4 rounded-lg bg-white/[0.06] ring-1 ring-white/[0.08] text-text-primary hover:bg-white/[0.1] transition-colors leading-tight"
                        >
                          <span className="text-[13px] font-semibold">Retake</span>
                          <span aria-hidden="true" className="text-[9px] font-normal text-text-muted">
                            keeps this take
                          </span>
                        </button>
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
                          className="min-h-[44px] px-5 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent/90 transition-colors"
                        >
                          Export
                        </button>
                      </div>

                      <p id="review-retake-note" className="sr-only">
                        Retake starts a new take. This recording stays in your library.
                      </p>

                      <PlatformPreviewSwitcher
                        sidebar
                        compact
                        selectedPlatformId={previewPlatformId}
                        onSelect={setPreviewPlatformId}
                        isLocked={(id) => !isCreatorUser && isPlatformLockedForUser(id, session?.user?.plan || 'free')}
                        onLockedClick={(id) => {
                          handlePlatformUpgradeRequired(id);
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>

            {activePanel === 'library' && (
              <div className="flex-1 min-h-0 overflow-auto">
                <RecordingsPanel
                  isAuthenticated={!!session?.user}
                  userPlan={userPlan}
                  refreshKey={exportJobs.length}
                    // Keyed on the persisted master take, NOT recorder.recordingResult:
                    // the take is written to IndexedDB from a video-element
                    // loadedmetadata callback, which runs AFTER recordingResult
                    // changes. Keying on the earlier value raced the write.
                    recordingsKey={masterRecordingData}
                  onAuthRequired={() => {
                    setAuthIntent('register');
                    ui.handleAuthRequired();
                  }}
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

            {(isStudio || recorder.recordingState !== 'idle') && (
              <TransportBar
                recordingState={recorder.recordingState}
                // Enabled with a live stream, after a released take (Start
                // re-acquires), or straight out of a restored review — the
                // return trip after an upgrade lands in a fresh document with
                // no camera, and the review canvas covers the Enable-camera
                // overlay. Pre-permission users outside review go through that
                // overlay instead; the button stays disabled for them. Never
                // during an in-flight permission request.
                canRecord={canStartRecording}
                hasRecording={isReview}
                isMicMuted={isMicMuted}
                elapsedSeconds={elapsedSeconds}
                recordBlockerHint={recordBlockerHint}
                  captureSource={captureSource}
                  onCaptureSourceChange={setCaptureSource}
                  isScreenSharing={screenCapture.isActive}
                  screenShareSupported={screenCapture.isSupported}
                  screenShareSurface={screenCapture.displaySurface}
                onMicToggle={handleMicToggle}
                onCameraToggle={handleCameraToggle}
                isCameraOn={isCameraOn}
                // No live stream means these chips are not live controls. They
                // used to read "Camera on / Mic on" before permission was even
                // granted, and stayed "on" through a permission failure.
                captureActive={!!camera.stream && camera.status === 'ready'}
                // Device picking lives behind the mic / camera chevrons now
                // (clean-canvas redesign) — same state and handlers the old
                // DeviceSelectorBar wrote; only the surface moved.
                videoDevices={camera.videoDevices}
                audioDevices={camera.audioDevices}
                selectedVideoDevice={settings.selectedVideoDevice}
                selectedAudioDevice={settings.selectedAudioDevice}
                onVideoDeviceChange={handleVideoDeviceChange}
                onAudioDeviceChange={handleAudioDeviceChange}
                onRefreshDevices={camera.refreshDevices}
                onStart={handleRecordStart}
                onPause={recorder.pauseRecording}
                onResume={() => {
                  const { scrollCallback, checkEndCallback } = buildScrollAndCheckEnd();
                  recorder.resumeRecording(scrollCallback, checkEndCallback);
                }}
                onStop={handleStopAndReleaseCamera}
                onCancelCountdown={() =>
                  recorder.cancelCountdown(masterRecordingData ? 'completed' : 'idle')
                }
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

        <Footer
          showShortcuts={isStudio}
          onShowShortcuts={handleShowShortcuts}
        />
      </div>

      <ExportModal
        isVisible={ui.isDrawerVisible}
        masterRecording={masterRecordingData}
        onClose={handleDismissDrawer}
        initialPlatformId={previewPlatformId}
        onPracticeAgain={handlePracticeAgain}
        // Workflow A destroys this session's take, so the sheet must ask;
        // Workflow B only detaches a library original, so it must not.
        practiceAgainDiscardsTake={!isLibraryOriginal}
        onOpenLibrary={handleOpenLibrary}
        onShare={share}
        showToast={showToast}
        isAuthenticated={!!session?.user}
        userPlan={session?.user?.plan || 'free'}
        onAuthRequired={() => {
          setAuthIntent('register');
          ui.handleAuthRequired();
        }}
        onDownloadLimitReached={handleUpgradeClick}
        exportConfig={exportConfig}
        onSelectPlatform={selectPlatform}
        // The format switch lives in the review tray, which is hidden while the
        // Library panel is visible (exporting a stored recording from there).
        // Reveal it so the "Change format" handoff has a visible target.
        onChangeFormat={() => setActivePanel('studio')}
        onStartExport={startExport}
        onCancelExport={() => cancelExport(exportJobs[exportJobs.length - 1]?.id || '')}
      />

      {/* New Video / Review delete both end a session, sometimes destroying the
          only copy of a take. They ask here, in the same dialog the rest of the
          Studio uses, instead of a native window.confirm. */}
      <ConfirmDialog
        isOpen={pendingConfirm !== null}
        title={pendingConfirmCopy.title}
        message={pendingConfirmCopy.message}
        confirmLabel={pendingConfirmCopy.confirmLabel}
        cancelLabel={pendingConfirmCopy.cancelLabel}
        onConfirm={() => {
          const action = pendingConfirm;
          if (!action) return;
          try {
            // Complete the requested transition before dismissing the dialog.
            // If a reset step fails, keep the confirmation visible and tell the
            // user instead of making the CTA appear to have silently done nothing.
            if (action === 'new-video') startNewVideoSession();
            else if (action === 'delete-take') deleteTakeAndStartFreshSession();
            setPendingConfirm(null);
          } catch {
            showToast(action === 'new-video'
              ? 'Could not start a new video. Please try again.'
              : 'Could not delete this recording. Please try again.');
          }
        }}
        onCancel={() => setPendingConfirm(null)}
      />

      <PricingModal
        isOpen={ui.isPricingModalOpen}
        onClose={() => {
          ui.setIsPricingModalOpen(false);
          setCheckoutIntent(null);
          // Clear upgrade intent if payment wasn't completed
          try { window.localStorage.removeItem('sxs-upgrade-intent'); } catch {}
        }}
        showToast={showToast}
        userPlan={session?.user?.plan || 'free'}
        isAuthenticated={!!session?.user}
        onAuthRequired={handlePricingAuthRequired}
        initialTier={checkoutIntent?.tier}
        initialBillingPeriod={checkoutIntent?.billingPeriod}
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
        intent={authIntent}
        onClose={() => {
          setPendingPricingAfterAuth(false);
          ui.setIsAuthModalOpen(false);
        }}
        onSuccess={handleAuthSuccessWithPricing}
        mode="download"
      />

      <Toast message={toast?.message ?? null} queueLength={queueLength} />
    </>
  );
}
