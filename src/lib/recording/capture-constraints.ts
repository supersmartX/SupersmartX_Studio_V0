'use client';

/**
 * Stable camera/microphone acquisition constraints (Phase 4).
 *
 * The recording is made from the raw camera MediaStream (composition to a
 * platform ratio happens at export), so the capture layer must ask for
 * high-quality SOURCE independently of which platform is selected. Constraints
 * are `ideal` — never `exact` — for geometry and frame rate so a device that
 * cannot deliver 1080p/30 degrades gracefully instead of failing outright,
 * while device selection keeps `exact` (choosing a specific device is the one
 * place the user's intent is unambiguous).
 */

export interface CaptureDimensions {
  width: number;
  height: number;
  frameRate: number;
}

/** Highest-quality rung: 1920×1080 @ 30 fps, front-facing default. */
export function buildPreferredVideoConstraints(deviceId?: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) return { ...base, deviceId: { exact: deviceId } };
  return { ...base, facingMode: 'user' };
}

/**
 * Microphone constraints. Echo cancellation / noise suppression / auto gain
 * are pinned explicitly (rather than trusting per-browser defaults) so the
 * recorded speech is deterministic across browsers; these are the right
 * settings for the studio's spoken-word use case.
 */
export function buildPreferredAudioConstraints(deviceId?: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) return { ...base, deviceId: { exact: deviceId } };
  return base;
}

/**
 * The full fallback ladder `useCamera` walks when a rung fails outright.
 * Each rung keeps the preferred audio processing; only the video geometry
 * degrades: 1080p → 720p → 480p → whatever the device exposes by default.
 */
export function buildCaptureConstraintLadder(deviceId?: string, audioDeviceId?: string): MediaStreamConstraints[] {
  const audio = buildPreferredAudioConstraints(audioDeviceId);
  const videoFallback = (width: number, height: number, frameRate?: number): MediaTrackConstraints => ({
    width: { ideal: width },
    height: { ideal: height },
    ...(frameRate ? { frameRate: { ideal: frameRate } } : {}),
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
  });
  return [
    { video: buildPreferredVideoConstraints(deviceId), audio },
    { video: videoFallback(1920, 1080, 24), audio },
    { video: videoFallback(1280, 720, 30), audio },
    { video: videoFallback(1280, 720, 24), audio },
    { video: videoFallback(640, 480, 30), audio },
    {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
    },
  ];
}

export interface CaptureCapabilities {
  width?: { min?: number; max?: number };
  height?: { min?: number; max?: number };
  frameRate?: { min?: number; max?: number };
  aspectRatio?: { min?: number; max?: number };
  facingMode?: string[];
  deviceId?: string;
}

/**
 * The ACTUAL settings the track handed back (Phase 4: "The UI should know the
 * ACTUAL recording configuration. Do not display values that are not actually
 * being used."). Undefined/zero entries are dropped by the caller; every
 * number here comes straight from the track, never from a target.
 */
export function readTrackCaptureInfo(stream: MediaStream | null): CaptureDimensions | null {
  const track = stream?.getVideoTracks?.()[0];
  const settings = track?.getSettings?.() as
    | { width?: number; height?: number; frameRate?: number; aspectRatio?: number; facingMode?: string; deviceId?: string }
    | undefined;
  if (!settings?.width || !settings?.height) return null;
  const frameRate = typeof settings.frameRate === 'number' && settings.frameRate > 0
    ? Math.round(settings.frameRate)
    : 0;
  return {
    width: Math.round(settings.width),
    height: Math.round(settings.height),
    frameRate,
  };
}

export interface ActualCaptureMetadata extends CaptureDimensions {
  deviceId: string | null;
}

/** Track settings are the only source for actual capture values. */
export function readTrackCaptureMetadata(stream: MediaStream | null): ActualCaptureMetadata | null {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return null;
  let settings: MediaTrackSettings;
  try {
    settings = track.getSettings();
  } catch {
    return null;
  }
  if (!settings.width || !settings.height) return null;
  let deviceId: string | null = null;
  try {
    deviceId = track?.getSettings?.().deviceId || null;
  } catch {
    // Device identifiers are optional and may be withheld by the browser.
  }
  return {
    width: settings.width,
    height: settings.height,
    frameRate: typeof settings.frameRate === 'number' && settings.frameRate > 0 ? settings.frameRate : 0,
    deviceId,
  };
}

/**
 * Read actual camera capabilities where supported (getCapabilities).
 * This helps distinguish requested vs actual and understand device limits.
 */
export function readTrackCaptureCapabilities(stream: MediaStream | null): CaptureCapabilities | null {
  const track = stream?.getVideoTracks?.()[0];
  if (!track || typeof track.getCapabilities !== 'function') {
    return null;
  }
  try {
    const caps = track.getCapabilities() as any;
    const result: CaptureCapabilities = {};
    if (caps.width) result.width = { min: caps.width.min, max: caps.width.max };
    if (caps.height) result.height = { min: caps.height.min, max: caps.height.max };
    if (caps.frameRate) result.frameRate = { min: caps.frameRate.min, max: caps.frameRate.max };
    if (caps.aspectRatio) result.aspectRatio = { min: caps.aspectRatio.min, max: caps.aspectRatio.max };
    if (Array.isArray(caps.facingMode)) result.facingMode = caps.facingMode;
    if (caps.deviceId) result.deviceId = caps.deviceId;
    return result;
  } catch {
    return null;
  }
}
