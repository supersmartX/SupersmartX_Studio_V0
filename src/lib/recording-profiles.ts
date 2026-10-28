import type { CaptureCapabilities, CaptureDimensions } from './recording/capture-constraints';
import type { SelectedRecordingCodec } from './recording/codec-capability';

export type RecordingProfileId = '1080p30' | '1080p-low-fps' | '720p30' | '720p-low-fps' | '480p30' | 'device-default';

export interface RecordingProfile {
  id: RecordingProfileId;
  tier: 'high' | 'standard' | 'compatibility' | 'unknown';
  targetWidth: number | null;
  targetHeight: number | null;
  targetFps: number | null;
  preferredCodecFamily: 'vp9' | 'vp8' | 'h264' | 'browser' | null;
  videoBitrate: number;
  audioBitrate: number;
}

export interface RecordingProfileSelection {
  capabilities: CaptureCapabilities | null;
  codec: SelectedRecordingCodec | null;
}

const AUDIO_BITRATE = 128_000;
const PROFILES: Array<Pick<RecordingProfile, 'id' | 'tier' | 'targetWidth' | 'targetHeight' | 'targetFps' | 'videoBitrate'>> = [
  { id: '1080p30', tier: 'high', targetWidth: 1920, targetHeight: 1080, targetFps: 30, videoBitrate: 8_000_000 },
  { id: '1080p-low-fps', tier: 'high', targetWidth: 1920, targetHeight: 1080, targetFps: 24, videoBitrate: 6_400_000 },
  { id: '720p30', tier: 'standard', targetWidth: 1280, targetHeight: 720, targetFps: 30, videoBitrate: 4_000_000 },
  { id: '720p-low-fps', tier: 'standard', targetWidth: 1280, targetHeight: 720, targetFps: 24, videoBitrate: 3_200_000 },
  { id: '480p30', tier: 'compatibility', targetWidth: 640, targetHeight: 480, targetFps: 30, videoBitrate: 2_500_000 },
];

function codecFamily(codec: SelectedRecordingCodec | null): RecordingProfile['preferredCodecFamily'] {
  if (!codec) return null;
  const mime = codec.mimeType.toLowerCase();
  if (mime.includes('vp9')) return 'vp9';
  if (mime.includes('vp8')) return 'vp8';
  if (mime.includes('h264') || mime.includes('avc')) return 'h264';
  return 'browser';
}

function canSupport(capabilities: CaptureCapabilities | null, width: number, height: number, fps: number): boolean {
  if (!capabilities) return true;
  const maxWidth = capabilities.width?.max;
  const maxHeight = capabilities.height?.max;
  const maxFps = capabilities.frameRate?.max;
  return (maxWidth === undefined || maxWidth >= width)
    && (maxHeight === undefined || maxHeight >= height)
    && (maxFps === undefined || maxFps >= fps);
}

/** Select the highest deterministic profile compatible with reported device limits. */
export function getBestRecordingProfile({ capabilities, codec }: RecordingProfileSelection): RecordingProfile {
  const family = codecFamily(codec);
  const selected = PROFILES.find((profile) =>
    profile.targetWidth !== null && profile.targetHeight !== null && profile.targetFps !== null
      && canSupport(capabilities, profile.targetWidth, profile.targetHeight, profile.targetFps),
  );
  if (!selected) {
    return {
      id: 'device-default', tier: 'unknown', targetWidth: null, targetHeight: null,
      targetFps: null, preferredCodecFamily: family, videoBitrate: 2_500_000, audioBitrate: AUDIO_BITRATE,
    };
  }
  return { ...selected, preferredCodecFamily: family, audioBitrate: AUDIO_BITRATE };
}

/** Describe the profile represented by the track settings actually delivered. */
export function profileForActualCapture(
  actual: CaptureDimensions | null,
  codec: SelectedRecordingCodec | null,
): RecordingProfile {
  if (!actual?.width || !actual.height) {
    return { ...getBestRecordingProfile({ capabilities: null, codec }), id: 'device-default', tier: 'unknown', targetWidth: null, targetHeight: null, targetFps: null };
  }
  const matching = PROFILES.find((profile) => {
    const width = profile.targetWidth ?? Infinity;
    const height = profile.targetHeight ?? Infinity;
    const geometryMatches = (actual.width >= width && actual.height >= height)
      || (actual.height >= width && actual.width >= height);
    return geometryMatches
      && (actual.frameRate === 0 || actual.frameRate >= (profile.targetFps ?? Infinity));
  });
  if (matching) return { ...matching, preferredCodecFamily: codecFamily(codec), audioBitrate: AUDIO_BITRATE };
  return {
    id: 'device-default', tier: 'unknown', targetWidth: null, targetHeight: null,
    targetFps: null, preferredCodecFamily: codecFamily(codec), videoBitrate: 2_500_000, audioBitrate: AUDIO_BITRATE,
  };
}
