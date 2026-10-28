'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioIcon, PauseIcon, PlayIcon, ReplayIcon, SpeakerMutedIcon } from '@/components/icons';
import { formatTime } from '@/utils/format';

interface ReviewPlayerProps {
  videoUrl: string;
  /** Shared-geometry crop style — same math as the export. */
  videoStyle?: React.CSSProperties;
  /**
   * The take's real length, from the master recording. MediaRecorder blobs
   * routinely report a non-finite `video.duration` until their last fragment
   * is read, so the element alone cannot size the scrubber or the clock.
   */
  recordedDuration?: number;
  /**
   * Whether the take actually contains audio. The mute control only renders
   * when there is sound to control; a silent take must not advertise one.
   */
  hasAudio: boolean;
  /**
   * Single-audible-player gate: the take plays only while its surface is
   * foreground. Opening the library or the export drawer pauses it; returning
   * resumes only if the creator had not paused it themselves.
   */
  isActive: boolean;
}

/** How long the transport stays up during playback after the last pointer move. */
const HIDE_DELAY_MS = 3000;

/** A position within this many seconds of the end counts as "ended" for the
 *  Play button, which then restarts from the top instead of no-oping. */
const END_EPSILON_SECONDS = 0.05;

/**
 * Review playback surface.
 *
 * The take is the product of the last take, so it must be watchable with the
 * same verbs a video has: play, pause, seek, restart — not just a mute toggle.
 * The transport sits at the TOP of the frame on purpose: the review tray is an
 * overlay anchored to the bottom of the canvas, so a bottom-anchored bar would
 * be covered by it on height-bound layouts (e.g. a 9:16 frame on desktop).
 *
 * The bar auto-hides during playback and stays up while paused, muted, or
 * keyboard-focused, so it can never strand the creator with either a hidden
 * control or a dimmed frame they cannot clear.
 */
export function ReviewPlayer({ videoUrl, videoStyle, recordedDuration = 0, hasAudio, isActive }: ReviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [wantsPlayback, setWantsPlayback] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [barPinned, setBarPinned] = useState(true);
  const [focusWithin, setFocusWithin] = useState(false);

  // Mirrors read by async play() resolutions: a pause that lands while play()
  // is still pending must win over the promise that started it.
  const wantsRef = useRef(true);
  const activeRef = useRef(isActive);

  const poke = useCallback(() => {
    setBarPinned(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setBarPinned(false), HIDE_DELAY_MS);
  }, []);

  const attemptPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .then(() => {
        if ((!wantsRef.current || !activeRef.current) && !video.paused) video.pause();
      })
      .catch(() => {
        // Audible playback needs a gesture. Start muted so the take still
        // plays, and keep the bar up (showBar includes `muted`) with the
        // sound control — the one tap that makes it audible again.
        video.muted = true;
        setMuted(true);
        video
          .play()
          .then(() => {
            if ((!wantsRef.current || !activeRef.current) && !video.paused) video.pause();
          })
          .catch(() => {
            // Both blocked: stay paused with the controls on screen.
            setWantsPlayback(false);
          });
      });
  }, []);

  // A new take starts from the top, audible — the contract this surface had
  // before it gained controls.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.muted = false;
    wantsRef.current = true;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setMuted(false);
    setWantsPlayback(true);
    setBarPinned(true);
  }, [videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    activeRef.current = isActive;
    wantsRef.current = wantsPlayback;
    if (!isActive || !wantsPlayback) {
      if (!video.paused) video.pause();
      return;
    }
    attemptPlay();
  }, [videoUrl, isActive, wantsPlayback, attemptPlay]);

  // Single writer of the element's mute property, so the button state and
  // playback can never disagree.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncDuration = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handlePlay = () => {
      setIsPlaying(true);
      poke();
    };
    const handlePause = () => {
      setIsPlaying(false);
      setBarPinned(true);
    };
    const handleEnded = () => {
      // No loop: an ended take must stay at its end so the scrub position is
      // real. Play then means "watch it again", handled in togglePlay.
      setIsPlaying(false);
      setBarPinned(true);
      setWantsPlayback(false);
    };

    video.addEventListener('loadedmetadata', syncDuration);
    video.addEventListener('durationchange', syncDuration);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('loadedmetadata', syncDuration);
      video.removeEventListener('durationchange', syncDuration);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoUrl, poke]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const total = Number.isFinite(duration) && duration > 0 ? duration : recordedDuration;
  const progress = total > 0 ? Math.min(1, currentTime / total) * 100 : 0;

  /** Where playback may sit. The element's own duration wins once it is real;
   *  until then (a MediaRecorder blob reports Infinity) the recorded length is
   *  the truth the tray also shows, so scrubbing is never a dead control. */
  const playbackLimit = useCallback(() => {
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    return total;
  }, [total]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    poke();
    if (wantsRef.current) {
      wantsRef.current = false;
      setWantsPlayback(false);
      if (!video.paused) video.pause();
      return;
    }
    wantsRef.current = true;
    const limit = playbackLimit();
    if (limit > 0 && video.currentTime >= limit - END_EPSILON_SECONDS) {
      video.currentTime = 0;
      setCurrentTime(0);
    }
    setWantsPlayback(true);
    // Play inside the gesture, not only from the effect: the muted fallback
    // needs this click as its user activation.
    if (isActive) attemptPlay();
  }, [attemptPlay, isActive, playbackLimit, poke]);

  const restart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setCurrentTime(0);
    poke();
    if (!wantsRef.current) {
      wantsRef.current = true;
      setWantsPlayback(true);
      if (isActive) attemptPlay();
    }
  }, [attemptPlay, isActive, poke]);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      const limit = playbackLimit();
      if (!video || limit <= 0) return;
      video.currentTime = Math.max(0, Math.min(limit, seconds));
      // Mirror immediately so aria-valuenow does not lag until the next timeupdate.
      setCurrentTime(video.currentTime);
    },
    [playbackLimit],
  );

  const handleSeekClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = seekRef.current;
      const limit = playbackLimit();
      if (!bar || limit <= 0) return;
      const rect = bar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekTo(percent * limit);
    },
    [playbackLimit, seekTo],
  );

  /** Same keyboard contract as the export player's seek bar: arrows step,
   *  Shift+Arrow fine-steps, Home/End jump to the ends. Keys stop here so the
   *  studio's recording shortcuts never see them. */
  const handleSeekKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      const limit = playbackLimit();
      if (!video || limit <= 0) return;
      const fine = e.shiftKey ? 1 : 5;
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = video.currentTime + fine;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          next = video.currentTime - fine;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = limit;
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
      seekTo(next);
    },
    [playbackLimit, seekTo],
  );

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // Visible while: recently poked, paused, keyboard-focused, or muted (the
  // sound affordance must never hide itself).
  const showBar = barPinned || !isPlaying || focusWithin || (hasAudio && muted);

  return (
    <div className="absolute inset-0" onPointerMove={poke} onPointerDown={poke}>
      <video
        ref={videoRef}
        src={videoUrl}
        style={videoStyle}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
      />

      <div
        ref={barRef}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && barRef.current?.contains(next)) return;
          setFocusWithin(false);
        }}
        /* Opacity-hidden rather than visibility/display-hidden: the controls
           must remain Tab-reachable, and focus reveals the bar through
           focusWithin. pointer-events-none stops the invisible bar from
           swallowing a click on the video. */
        className={`absolute inset-x-0 top-0 z-20 p-2 sm:p-2.5 transition-opacity ${
          showBar ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="review-transport flex items-center gap-0.5 rounded-full bg-black/60 px-1 py-1 backdrop-blur-md ring-1 ring-white/[0.08] shadow-md">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
            title={isPlaying ? 'Pause' : 'Play'}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors"
          >
            {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={restart}
            aria-label="Restart playback"
            title="Restart"
            className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ReplayIcon className="w-4 h-4" />
          </button>

          <div className="flex-1 min-w-0 flex items-center h-11 px-1">
            <div
              ref={seekRef}
              role="slider"
              tabIndex={0}
              aria-label="Seek playback position"
              aria-valuemin={0}
              aria-valuemax={Math.round(total * 10) / 10}
              aria-valuenow={Math.round(currentTime * 10) / 10}
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(total)}`}
              onKeyDown={handleSeekKeyDown}
              onClick={handleSeekClick}
              className="group/seek relative w-full h-1.5 rounded-full bg-white/25 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
              <div
                aria-hidden="true"
                className="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform group-hover/seek:scale-125"
                style={{ left: `${progress}%` }}
              />
            </div>
          </div>

          <span
            aria-hidden="true"
            className="review-transport-time text-[10px] font-mono tabular-nums text-white/75 whitespace-nowrap px-1"
          >
            {formatTime(currentTime)} / {formatTime(total)}
          </span>

          {hasAudio && (
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute review playback' : 'Mute review playback'}
              aria-pressed={!muted}
              title={muted ? 'Unmute' : 'Mute'}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              {muted ? <SpeakerMutedIcon className="w-4 h-4" /> : <AudioIcon className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
