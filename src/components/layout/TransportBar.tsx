'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { RecordingState, CaptureSource } from '@/types';
import { formatTime } from '@/utils/format';
import {
  CameraIcon,
  CameraOffIcon,
  CheckIcon,
  ChevronDownIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PauseIcon,
  PlayIcon,
  RecordIcon,
  RefreshIcon,
  ScreenShareIcon,
  StopIcon,
} from '@/components/icons';
import { DailyRecordingIndicator } from '@/components/studio/DailyRecordingIndicator';

/**
 * Stable id for the line that names the current Start blocker.
 *
 * Exported because it is the `aria-describedby` target of the Start button and
 * therefore part of this component's accessibility contract: it is rendered by
 * the transport itself, so it exists whenever `canRecord` is false and the
 * description can never point at a missing element.
 */
export const RECORD_BLOCKER_HINT_ID = 'studio-record-blocker-hint';

interface TransportBarProps {
  recordingState: RecordingState;
  canRecord: boolean;
  hasRecording: boolean;
  isMicMuted: boolean;
  elapsedSeconds: number;
  /**
   * UX-002: why Start is unavailable right now, already resolved from real
   * application state by the caller. `null` renders no hint and no description.
   * Kept as a prop so this bar never has to know *why* it is disabled.
   */
  recordBlockerHint?: string | null;
  onMicToggle: () => void;
  onCameraToggle: () => void;
  isCameraOn: boolean;
  captureSource: CaptureSource;
  onCaptureSourceChange: (source: CaptureSource) => void;
  isScreenSharing: boolean;
  screenShareSupported: boolean;
  screenShareSurface?: 'monitor' | 'window' | 'browser' | null;
  /**
   * True only while a live capture stream exists. Before permission is granted
   * (or after a failure) the mic/camera chips are not live controls, so they
   * must not claim "Camera on / Mic on" and must not pretend to toggle.
   */
  captureActive: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onConfirmStop?: () => void;
  /**
   * Shown (with the countdown state) as the transport's way out of a 3-2-1
   * that started by accident. The canvas overlay has its own cancel; this
   * keeps the bar from going inert while the countdown runs.
   */
  onCancelCountdown?: () => void;
  /**
   * Device PICKING moved here (clean-canvas redesign). The bar above the
   * canvas used to carry two permanent <select> rows — technical chrome the
   * creator reads on every load. Device choice is a tertiary decision, so it
   * now lives behind the chevron of the mic / camera chip: one tap to open,
   * real device lists, real selection, no duplication with the inspector.
   * The lists come straight from the camera hook (enumerateDevices) — never
   * invented.
   */
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  onVideoDeviceChange: (deviceId: string) => void;
  onAudioDeviceChange: (deviceId: string) => void;
  onRefreshDevices: () => void;
  /**
   * The Free daily recording budget, already resolved by the caller from real
   * state (`null` remaining = Creator/unlimited). When provided it renders the
   * DailyRecordingIndicator in the bar's right zone — until now that budget
   * was only ever announced in toasts and enforced by an auto-stop, with no
   * always-visible read-out. Omitted (tests, other hosts) renders the zone
   * exactly as before: an empty optical mirror.
   */
  dailyBudget?: { remainingSeconds: number | null; totalSeconds: number } | null;
}

/**
 * UX-016 — narrow live announcement for the recording clock.
 *
 * The elapsed timer ticks once per second and marking it as `aria-live="polite"`
 * would make a screen reader re-announce every second for the whole length of a
 * take: unusable, and the opposite of the intent. So the visible numbers stay
 * outside live regions (the ticking span carries an explicit `aria-live="off"`),
 * and this region speaks only the moments that carry meaning — start, pause,
 * resume, and the final elapsed time on stop.
 *
 * `elapsedSeconds` is read AT the transition rather than on every tick, so the
 * value is announced once at each change instead of continuously. The guard at
 * the top of the effect is what makes that true: the effect still runs every
 * second, but it returns without touching state unless the STATE changed.
 */
function RecordingAnnouncer({ recordingState, elapsedSeconds }: { recordingState: RecordingState; elapsedSeconds: number }) {
  const [message, setMessage] = useState('');
  const previousState = useRef<RecordingState | null>(null);

  useEffect(() => {
    if (previousState.current === recordingState) return;
    const from = previousState.current;
    previousState.current = recordingState;
    // Never announce on mount — that would describe a state the user never
    // entered.
    if (from === null) return;

    const at = formatTime(elapsedSeconds);
    if (recordingState === 'recording') {
      setMessage(from === 'paused' ? `Recording resumed. Elapsed ${at}.` : 'Recording started.');
    } else if (recordingState === 'paused') {
      setMessage(`Recording paused. Elapsed ${at}.`);
    } else if (recordingState === 'completed') {
      // Cancelling a countdown can return straight to a previous review
      // (`completed`) without ever capturing. That is NOT a stopped take and
      // must not claim a new recording is ready.
      setMessage(
        from === 'countdown'
          ? 'Countdown cancelled.'
          : `Recording stopped. Your recording is ready to review. Elapsed ${at}.`,
      );
    } else if (recordingState === 'idle') {
      setMessage(from === 'countdown' ? 'Countdown cancelled.' : '');
    } else {
      // The countdown overlay owns its own live region; do not double-speak.
      setMessage('');
    }
  }, [recordingState, elapsedSeconds]);

  // Bare live region rather than role="status": the transport already contains a
  // role="status" (the blocker hint, and the REC chip), so adding another would
  // duplicate the landmark and make `getByRole('status')` ambiguous in both this
  // suite and the e2e helpers. aria-live alone announces the same.
  return (
    <span aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </span>
  );
}

/** Which (if any) device popover is open. Exclusive — one list at a time. */
type DeviceMenu = 'mic' | 'camera' | null;

/** Behavior of one device picker entry. `null` id text = browser default. */
function deviceLabel(device: MediaDeviceInfo, fallbackPrefix: string): string {
  return device.label || `${fallbackPrefix} ${device.deviceId.slice(0, 8)}`;
}

/**
 * One secondary control cluster: the toggle (mute / camera on-off) plus a
 * chevron that opens the device popover. The toggle keeps its exact historical
 * aria contract (labels + aria-pressed come from tests); the chevron is the
 * progressive-disclosure affordance that replaced the permanent selects.
 */
function DeviceChip({
  deviceName,
  ariaLabel,
  ariaPressed,
  stateLabel,
  stateLabelOff,
  isOff,
  icon,
  menuKind,
  openMenu,
  setOpenMenu,
  onToggle,
  disabled,
  inactive = false,
  title,
  menu,
}: {
  /** Stable name for the chevron's accessible label ("Microphone device options"). */
  deviceName: string;
  ariaLabel: string;
  ariaPressed?: boolean;
  stateLabel: string;
  stateLabelOff: string;
  isOff: boolean;
  icon: ReactNode;
  menuKind: Exclude<DeviceMenu, null>;
  openMenu: DeviceMenu;
  setOpenMenu: (m: DeviceMenu) => void;
  onToggle: () => void;
  disabled: boolean;
  /** No live capture: the chip shows the off state and its toggle is inert. */
  inactive?: boolean;
  title?: string;
  /** The device list, positioned relative to THIS chip (not the bar). */
  menu?: ReactNode;
}) {
  const isOpen = openMenu === menuKind;
  return (
    <div
      className={`relative flex items-center rounded-full transition-colors ${
        inactive
          ? 'bg-white/[0.03] ring-1 ring-white/[0.05]'
          : isOff
            ? 'bg-recording/10 ring-1 ring-recording/25'
            : 'bg-white/[0.04] ring-1 ring-white/[0.06] hover:bg-white/[0.07]'
      }`}
    >
      <button
        onClick={onToggle}
        aria-pressed={ariaPressed}
        aria-label={ariaLabel}
        title={title}
        disabled={inactive}
        className={`flex items-center gap-1.5 pl-2.5 pr-1.5 sm:pl-3 sm:pr-2 rounded-full transition-colors min-w-[44px] min-h-[44px] disabled:cursor-not-allowed ${
          isOff ? 'text-white' : inactive ? 'text-text-muted' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        <span className={isOff ? 'text-recording' : ''}>{icon}</span>
        <span
          className={`hidden 3xl:inline text-[11px] font-medium tracking-[0.01em] whitespace-nowrap ${
            isOff ? 'text-white/90' : inactive ? 'text-text-muted' : 'text-text-secondary'
          }`}
        >
          {isOff || inactive ? stateLabelOff : stateLabel}
        </span>
      </button>
      <button
        onClick={() => setOpenMenu(isOpen ? null : menuKind)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`${deviceName} device options`}
        title="Device options"
        className="flex items-center justify-center w-7 max-sm:w-6 h-11 rounded-full text-text-muted transition-colors hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* The popover is a fixed sheet centred just above the transport at every
          viewport width. It must not be absolutely positioned inside the chips
          row: that row is a horizontal scroll container, and a scroll container
          clips (or scrolls) anything positioned inside it — the menu would be
          cut off to the bar's 44px height exactly when the row overflows. */}
      {isOpen && menu && (
        <div className="device-popover fixed bottom-20 left-1/2 z-30 w-[260px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 animate-popover-in">
          {menu}
        </div>
      )}
    </div>
  );
}

interface DeviceMenuItem {
  deviceId: string;
  label: string;
}

/** The popover body shared by both chips: list + refresh + honest empty state. */
function DeviceMenuList({
  heading,
  emptyText,
  items,
  selectedDeviceId,
  onSelect,
}: {
  heading: string;
  emptyText: string;
  items: DeviceMenuItem[];
  selectedDeviceId: string;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <div role="menu" aria-label={heading} className="max-h-72 overflow-auto py-1.5">
      <p className="px-3.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {heading}
      </p>
      {items.length === 0 ? (
        <p className="px-3.5 py-2 text-[12px] text-text-muted">{emptyText}</p>
      ) : (
        items.map((item) => {
          // An empty persisted selection means "the browser default"; the
          // entry whose id is 'default' is then the active one.
          const selected = selectedDeviceId
            ? item.deviceId === selectedDeviceId
            : item.deviceId === 'default';
          return (
            <button
              key={item.deviceId}
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => onSelect(item.deviceId)}
              className={`mx-1.5 flex w-[calc(100%_-_0.75rem)] items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors min-h-10 ${
                selected
                  ? 'bg-accent/10 text-text-primary'
                  : 'text-text-secondary hover:bg-white/[0.05] hover:text-text-primary'
              }`}
            >
              <span className="truncate">{item.label}</span>
              {selected && <CheckIcon className="w-3.5 h-3.5 text-accent-text shrink-0" />}
            </button>
          );
        })
      )}
    </div>
  );
}

export function TransportBar({
  recordingState,
  canRecord,
  hasRecording,
  isMicMuted,
  isCameraOn,
  captureSource,
  onCaptureSourceChange,
  isScreenSharing,
  screenShareSupported,
  screenShareSurface = null,
  captureActive,
  elapsedSeconds,
  recordBlockerHint = null,
  onMicToggle,
  onCameraToggle,
  onStart,
  onPause,
  onResume,
  onStop,
  onConfirmStop,
  onCancelCountdown,
  videoDevices,
  audioDevices,
  selectedVideoDevice,
  selectedAudioDevice,
  onVideoDeviceChange,
  onAudioDeviceChange,
  onRefreshDevices,
  dailyBudget = null,
}: TransportBarProps) {
  const isIdle = recordingState === 'idle' || recordingState === 'completed';
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const isCountdown = recordingState === 'countdown';
  const [confirmStop, setConfirmStop] = useState(false);
  const [openMenu, setOpenMenu] = useState<DeviceMenu>(null);
  const transportRef = useRef<HTMLElement>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The armed "OK?" state belongs to ONE take. Without this reset, a take
  // that ended some other way (auto-stop at the daily/script limit, a
  // cancelled countdown) left the next Stop pre-armed — one click would
  // discard a take the user had just started.
  useEffect(() => {
    setConfirmStop(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setOpenMenu(null);
  }, [recordingState]);

  // A tap always STARTS a take; stopping is always an explicit Stop. The old
  // "hold 500ms to start, release to stop" pattern raced the 3-2-1 countdown and
  // dropped accidental near-empty takes: releasing during the countdown left a
  // silently running camera, and holding into the take instantly discarded it.
  const handleStopClick = useCallback(() => {
    if (confirmStop) {
      setConfirmStop(false);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      onConfirmStop ? onConfirmStop() : onStop();
    } else {
      setConfirmStop(true);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmStop(false);
      }, 3000);
    }
  }, [confirmStop, onStop, onConfirmStop]);

  // Device popovers close on Escape and on a click anywhere outside the
  // transport — a pointerdown listener on the document is the small, dependable
  // way to do that without a z-fighting full-screen click-catcher.
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (transportRef.current && !transportRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // Device lists are real enumerateDevices output; the anonymous-id labels are
  // the renderer's own fallback used before permission lifts the device names.
  const micItems = audioDevices.map((d) => ({
    deviceId: d.deviceId,
    label: deviceLabel(d, 'Microphone'),
  }));
  const cameraItems = videoDevices.map((d) => ({
    deviceId: d.deviceId,
    label: deviceLabel(d, 'Camera'),
  }));

  // Selecting a device re-acquires the stream (useStudioCamera), which must
  // never happen while (or just before) a capture is in flight. The chevron
  // only reopens in an idle state.
  const devicePickUnavailable = !isIdle;

  const micMenu = (
    <div className="w-[260px] max-w-full max-sm:w-full overflow-hidden rounded-xl border border-border-default bg-elevated shadow-2xl">
      <DeviceMenuList
        heading="Microphone"
        emptyText="No microphone found — reload devices below."
        items={micItems}
        selectedDeviceId={selectedAudioDevice}
        onSelect={(deviceId) => {
          onAudioDeviceChange(deviceId);
          setOpenMenu(null);
        }}
      />
      <div className="border-t border-white/[0.06]">
        <button
          onClick={onRefreshDevices}
          aria-label="Refresh devices"
          className="w-full flex items-center gap-2 px-3.5 py-2 text-[12px] text-text-muted hover:text-text-primary hover:bg-white/[0.05] transition-colors min-h-10"
        >
          <RefreshIcon className="w-3.5 h-3.5" />
          <span>Refresh devices</span>
        </button>
      </div>
    </div>
  );

  const cameraMenu = (
    <div className="w-[260px] max-w-full max-sm:w-full overflow-hidden rounded-xl border border-border-default bg-elevated shadow-2xl">
      <DeviceMenuList
        heading="Camera"
        emptyText="No camera found — reload devices below."
        items={cameraItems}
        selectedDeviceId={selectedVideoDevice}
        onSelect={(deviceId) => {
          onVideoDeviceChange(deviceId);
          setOpenMenu(null);
        }}
      />
      <div className="border-t border-white/[0.06]">
        <button
          onClick={onRefreshDevices}
          aria-label="Refresh devices"
          className="w-full flex items-center gap-2 px-3.5 py-2 text-[12px] text-text-muted hover:text-text-primary hover:bg-white/[0.05] transition-colors min-h-10"
        >
          <RefreshIcon className="w-3.5 h-3.5" />
          <span>Refresh devices</span>
        </button>
      </div>
    </div>
  );

  return (
    <footer
      ref={transportRef}
      // Three grid columns at EVERY width (not only below lg): the 1fr side
      // cells keep the primary action exactly centred whether or not the
      // right cell has content. A flex mirror (`flex-1` on both zones) was
      // the previous desktop layout and is what pushed the device chips under
      // the Record button — flex shares are fixed at 50/50, so any extra left
      // content (inspector open at 1280–1439, mode labels at 2xl, the daily
      // budget indicator) overflowed into the centre column instead of
      // competing for space.
      className="relative h-16 lg:h-14 border-t border-border-subtle bg-surface/95 backdrop-blur-sm grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 lg:gap-3 px-3 sm:px-6 shrink-0 z-20"
      aria-label="Recording controls"
    >
      {/* UX-002: a disabled Start used to be a dimmed circle whose only
          explanation lived inside the canvas. This line is anchored to the
          transport itself (centred on the BAR, not the action cluster, so it
          can never run off a phone screen), so the reason for the disabled
          state is readable here without hunting for it. Absolutely positioned
          above the bar so the fixed-height footer — and therefore the canvas —
          never reflows. */}
      {recordBlockerHint && (
        <p
          id={RECORD_BLOCKER_HINT_ID}
          // `aria-describedby` alone is not enough here: a DISABLED button
          // cannot take keyboard focus, so its description is only ever read
          // in browse mode — never announced when the user is on the control.
          // This line does change under the user (permission asked → granted
          // or refused), so it announces that transition politely, matching
          // the repo's transient-state pattern (Toast, RecordingBadge).
          // Polite, not assertive: it explains, it does not interrupt, and
          // the hint unmounting when Start enables produces no announcement.
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 max-w-[min(24rem,calc(100vw-2rem))] rounded-md border border-border-subtle bg-surface/95 px-2.5 py-1 text-center text-[11px] leading-snug font-medium text-text-secondary shadow-lg backdrop-blur-sm"
        >
          {recordBlockerHint}
        </p>
      )}

      {/* Left: the device chips. The cell is `minmax(0,1fr)`, so the chips row
          shrinks and scrolls instead of ever running under the centred
          primary action; the row rarely needs it (labels yield below 3xl). */}
      <div className="min-w-0 flex items-center gap-2 lg:gap-3 col-start-1 row-start-1">
        <RecordingAnnouncer recordingState={recordingState} elapsedSeconds={elapsedSeconds} />

        {/* Idle clock: the quiet 00:00 only where the bar has room to spare
            (2xl+). Below that it was decorative dead weight that squeezed the
            device chips toward the centred Record button — and on phones it
            previously rendered UNDER the chips (both were placed in the same
            grid cell). Elapsed time is carried by the canvas Timer, and the
            state by the primary control, so no information is lost. */}
        {isIdle && !hasRecording && (
          <div className="hidden 2xl:flex flex-col min-w-0 shrink-0">
            <span className="text-[15px] font-mono font-semibold text-text-secondary tabular-nums">00:00</span>
            <span className="sr-only">Recording time</span>
          </div>
        )}

        {/* Active clock: the bar only has room for it at lg+. Below that the
            canvas Timer carries elapsed time — one clock per layout, never
            two competing read-outs of the same value. The state itself is
            carried by the canvas badge + the primary control, so no extra
            "Recording"/"Paused" label is repeated here. */}
        {(isRecording || isPaused || elapsedSeconds > 0) && (
          <div className="hidden lg:flex flex-col min-w-0 shrink-0">
            {/* UX-016: this value changes every 1000ms. It is pinned OUT of any
                live region on purpose — see RecordingAnnouncer above. */}
            <span
              aria-live="off"
              className={`text-[15px] font-mono font-semibold tabular-nums ${
                isPaused ? 'text-warning' : 'text-text-primary'
              }`}
            >
              {formatTime(elapsedSeconds)}
            </span>
          </div>
        )}

        {/* Preparing/recording only. In review the camera and microphone are
            released, so these chips would edit the NEXT take while looking like
            live controls for the finished one. The review surface owns the
            re-acquire/start-fresh path instead. */}
        {!hasRecording && (
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Capture source — Camera, Screen, or Screen + Webcam. Switching
                is only allowed while idle so a live take is never disrupted:
                the group itself unmounts during a take. The mode labels yield
                to icons below 3xl — the three radios must clear the centred
                primary action at common desktop widths (at 1440px the labelled
                row ran underneath the Record button, which then swallowed
                every click meant for the camera chip). Accessible names are
                pinned by aria-label, so the icon-only form keeps its contract. */}
            {isIdle && (
            <div className="inline-flex items-center rounded-lg border border-border-default bg-surface/60 p-0.5 shrink-0" role="radiogroup" aria-label="Capture source">
              <button
                type="button"
                role="radio"
                aria-label="Camera"
                aria-checked={captureSource === 'camera'}
                onClick={() => onCaptureSourceChange('camera')}
                disabled={devicePickUnavailable}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors min-h-[36px] ${
                  captureSource === 'camera'
                    ? 'bg-elevated text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title="Record camera"
              >
                <CameraIcon className="w-3.5 h-3.5" />
                <span className="hidden 3xl:inline">Camera</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-label="Screen"
                aria-checked={captureSource === 'screen'}
                onClick={() => onCaptureSourceChange('screen')}
                disabled={devicePickUnavailable || !screenShareSupported}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors min-h-[36px] ${
                  captureSource === 'screen'
                    ? 'bg-elevated text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={screenShareSupported ? 'Share screen' : 'Screen sharing is not supported in this browser'}
              >
                <ScreenShareIcon className="w-3.5 h-3.5" />
                <span className="hidden 3xl:inline">Screen</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-label="Screen + Cam"
                aria-checked={captureSource === 'screen-camera'}
                onClick={() => onCaptureSourceChange('screen-camera')}
                disabled={devicePickUnavailable || !screenShareSupported}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors min-h-[36px] ${
                  captureSource === 'screen-camera'
                    ? 'bg-elevated text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={screenShareSupported ? 'Record your screen with a floating webcam' : 'Screen sharing is not supported in this browser'}
              >
                <ScreenShareIcon className="w-3.5 h-3.5" />
                <CameraIcon className="-ml-2 w-3 h-3" />
                <span className="hidden 3xl:inline">Screen + Cam</span>
              </button>
            </div>
            )}

            <DeviceChip
              deviceName="Microphone"
              ariaLabel={
                captureActive
                  ? isMicMuted
                    ? 'Unmute microphone'
                    : 'Mute microphone'
                  : 'Mic off — not started'
              }
              ariaPressed={captureActive ? isMicMuted : undefined}
              stateLabel="On"
              stateLabelOff={captureActive ? 'Muted' : 'Off'}
              isOff={!captureActive || isMicMuted}
              icon={
                !captureActive || isMicMuted ? (
                  <MicrophoneOffIcon className="w-4 h-4" />
                ) : (
                  <MicrophoneIcon className="w-4 h-4" />
                )
              }
              menuKind="mic"
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
              onToggle={onMicToggle}
              disabled={devicePickUnavailable || !captureActive}
              inactive={!captureActive}
              menu={micMenu}
            />

            {captureSource !== 'camera' && (
              <div
                className="inline-flex h-11 shrink-0 items-stretch overflow-hidden rounded-xl border border-accent/30 bg-accent/10 text-accent"
                title={
                  isScreenSharing
                    ? `Screen sharing active${screenShareSurface ? ` (${screenShareSurface === 'monitor' ? 'Entire Screen' : screenShareSurface === 'window' ? 'Window' : 'Browser Tab'})` : ''}`
                    : 'Screen sharing not started'
                }
              >
                <span className="flex shrink-0 items-center justify-center gap-1.5 px-2.5 sm:px-3 text-sm font-medium">
                  <ScreenShareIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {isScreenSharing
                      ? screenShareSurface === 'monitor'
                        ? 'Entire Screen'
                        : screenShareSurface === 'window'
                          ? 'Window'
                          : screenShareSurface === 'browser'
                            ? 'Tab'
                            : 'Sharing'
                      : 'Screen'}
                  </span>
                </span>
              </div>
            )}
            {captureSource !== 'screen' && (
              <DeviceChip
                deviceName="Camera"
                ariaLabel={
                  captureActive
                    ? isCameraOn
                      ? 'Turn off camera'
                      : 'Turn on camera'
                    : 'Camera off — not started'
                }
                ariaPressed={captureActive ? !isCameraOn : undefined}
                stateLabel="On"
                stateLabelOff="Off"
                isOff={!captureActive || !isCameraOn}
                icon={
                  !captureActive || !isCameraOn ? (
                    <CameraOffIcon className="w-4 h-4" />
                  ) : (
                    <CameraIcon className="w-4 h-4" />
                  )
                }
                menuKind="camera"
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                onToggle={onCameraToggle}
                disabled={devicePickUnavailable || !captureActive}
                inactive={!captureActive}
                menu={cameraMenu}
              />
            )}
          </div>
        )}
      </div>

            {/* Center: the primary action — exact centre of the bar. Secondary
          pause/stop is absolutely positioned so the primary never drifts off
          centre: to its right from sm up, to its left on phones (the device
          chips own the right edge there). */}
      <div className="relative flex items-center justify-center gap-2 sm:gap-3 shrink-0 col-start-2 row-start-1">
        {/* In review, Export is the primary action and Retake lives on the
            review surface. Leaving a second Record here duplicated the action
            and implied the finished take could be overwritten in place. */}
        {isIdle && !hasRecording && (
          <button
            onClick={onStart}
            disabled={!canRecord}
            className="flex items-center justify-center gap-2 h-11 w-11 sm:h-12 sm:w-auto sm:px-6 rounded-full bg-recording text-white ring-1 ring-white/10 transition-[background-color,box-shadow,transform] duration-200 shadow-lg shadow-recording/30 hover:bg-red-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none select-none shrink-0 animate-scale-in"
            aria-label="Start Recording"
            // Describes the disabled state from the element the screen reader is
            // already on, instead of making the user leave it to find out why.
            aria-describedby={recordBlockerHint ? RECORD_BLOCKER_HINT_ID : undefined}
          >
            <RecordIcon className="w-4 sm:w-5 h-4 sm:h-5" />
            <span className="hidden sm:inline text-[14px] font-semibold tracking-[0.02em]">Record</span>
          </button>
        )}

        {isRecording && (
          <button
            onClick={handleStopClick}
            className={`flex items-center justify-center gap-2 h-11 sm:h-12 rounded-full text-white transition-[background-color,box-shadow,transform] duration-200 shadow-lg active:scale-[0.98] shrink-0 animate-scale-in ${
              // The armed state never widens the pill on phones: the device
              // chips own the bar's right edge there, so an inline "Stop?" would
              // run into them at 375px. The visible cue moves to the secondary
              // slot on the left instead (see below), keeping the red target
              // exactly centred and 44px wide.
              confirmStop ? 'w-11 px-0 sm:w-auto sm:px-6 bg-recording ring-2 ring-white/30 shadow-recording/40' : 'w-11 px-0 sm:w-auto sm:px-6 bg-recording ring-1 ring-white/10 hover:bg-red-600 shadow-recording/30'
            }`}
            aria-label="Stop Recording"
          >
            <StopIcon className="w-4 sm:w-5 h-4 sm:h-5" />
            {confirmStop ? (
              <span className="hidden sm:inline text-[13px] font-bold tracking-[0.02em]">Stop?</span>
            ) : (
              <span className="hidden sm:inline text-[14px] font-semibold tracking-[0.02em]">Stop</span>
            )}
          </button>
        )}

        {/* Armed confirmation on phones: Pause has just vacated this slot, so
            the eye is already here. Plain text rather than a pill so it never
            reads as a third tap target, and it stays inside the bar instead of
            floating over the canvas on short viewports. */}
        {isRecording && confirmStop && (
          <span
            aria-hidden="true"
            className="sm:hidden absolute top-1/2 right-full mr-2 -translate-y-1/2 whitespace-nowrap text-[13px] font-bold tracking-[0.02em] text-white pointer-events-none"
          >
            Stop?
          </span>
        )}

        {isPaused && (
          <button
            onClick={onResume}
            className="flex items-center justify-center gap-2 h-11 w-11 sm:h-12 sm:w-auto sm:px-6 rounded-full bg-accent hover:bg-accent-hover text-white ring-1 ring-white/10 transition-[background-color,box-shadow,transform] duration-200 shadow-lg shadow-accent/30 active:scale-[0.98] shrink-0 animate-scale-in"
            aria-label="Resume Recording"
          >
            <PlayIcon className="w-4 sm:w-5 h-4 sm:h-5" />
            <span className="hidden sm:inline text-[14px] font-semibold tracking-[0.02em]">Resume</span>
          </button>
        )}

        {/* Countdown: the 3-2-1 owns the screen, but the transport must not
            go dead — this is the always-visible way out of a countdown that
            started by accident. Cancels without consuming anything. Named
            distinctly from the overlay's "Cancel countdown" so assistive
            tech (and the e2e locators) never see two identical controls. */}
        {isCountdown && (
          <button
            onClick={onCancelCountdown}
            className="flex items-center justify-center gap-1.5 h-11 sm:h-12 px-4 max-sm:px-2.5 max-sm:min-w-[44px] rounded-full bg-white/[0.06] ring-1 ring-white/[0.08] text-text-secondary hover:text-text-primary hover:bg-white/[0.09] transition-colors shrink-0"
            aria-label="Stop countdown"
          >
            <StopIcon className="w-4 h-4" />
            {/* Icon-only on phones: the labelled pill would collide with the
                device chips now sitting at the right edge of the bar. */}
            <span className="max-sm:hidden text-[12px] font-medium">Cancel</span>
          </button>
        )}

        {/* Pause (secondary) — right of the primary only on desktop; to its
            LEFT below lg: the device chips sit at the bar's right edge there,
            so a right-hand pause would run into them. Absolutely positioned
            either way so the red Stop stays exactly centred. */}
        {isRecording && !confirmStop && (
          <button
            onClick={onPause}
            aria-label="Pause Recording"
            // While Stop is armed ("Stop?") the NEXT click anywhere in this
            // cluster means "stop" — letting Pause take that click would
            // stop the take from a button that says Pause. It is removed
            // rather than merely disabled so a second tap can only mean Stop.
            className="absolute top-1/2 right-full mr-1.5 -translate-y-1/2 flex items-center justify-center gap-1.5 px-2.5 rounded-full transition-colors min-w-[44px] min-h-[44px] shrink-0 text-text-muted hover:text-text-primary hover:bg-white/[0.06] lg:left-full lg:right-auto lg:ml-1.5 lg:mr-0"
          >
            <PauseIcon className="w-4 h-4" />
          </button>
        )}

        {isPaused && (
          <button
            onClick={handleStopClick}
            // Stable accessible name: the visible label arms Stop → Confirm,
            // but screen readers always hear "Stop Recording".
            aria-label="Stop Recording"
            className={`absolute top-1/2 right-full mr-1.5 -translate-y-1/2 flex items-center justify-center gap-1.5 px-2.5 rounded-full transition-colors min-w-[44px] min-h-[44px] shrink-0 lg:left-full lg:right-auto lg:ml-1.5 lg:mr-0 ${
              confirmStop
                ? 'text-recording bg-recording/10 ring-1 ring-recording/30'
                : 'text-text-muted hover:text-recording hover:bg-recording/10'
            }`}
          >
            <StopIcon className="w-4 h-4" />
            <span className="hidden sm:inline text-[12px] font-medium">{confirmStop ? 'Confirm' : 'Stop'}</span>
          </button>
        )}
      </div>

      {/* Right zone: the mirror 1fr cell that keeps the primary action
          centred; it hosts the Free daily budget indicator when there is one
          — always visible, not a toast the user has to catch. */}
      <div
        className="shrink-0 min-w-0 flex justify-end justify-self-end col-start-3 row-start-1"
        aria-hidden={!dailyBudget}
      >
        {dailyBudget && (
          <DailyRecordingIndicator
            remainingSeconds={dailyBudget.remainingSeconds}
            totalSeconds={dailyBudget.totalSeconds}
            isRecording={isRecording || isPaused}
          />
        )}
      </div>
    </footer>
  );
}
