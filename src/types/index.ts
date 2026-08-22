export type RecordingState = 'idle' | 'countdown' | 'recording' | 'paused' | 'completed';

export type TabType = 'studio' | 'library' | 'insights';

export type HeaderTab = 'studio' | 'script' | 'camera' | 'audio';

export type TextAlignment = 'left' | 'center' | 'right';

export type AspectRatio = '16:9' | '9:16' | '4:3' | '1:1' | '4:5';

export type PlatformId =
  | 'youtube-landscape'
  | 'youtube-shorts'
  | 'instagram-reels'
  | 'tiktok'
  | 'instagram-post'
  | 'instagram-portrait'
  | 'linkedin'
  | 'custom';

export interface PlatformPreset {
  id: PlatformId;
  label: string;
  sublabel: string;
  icon: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
}

export interface RecordingConfiguration {
  platformId: PlatformId;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
  videoDeviceId: string;
  audioDeviceId: string;
  isMirrored: boolean;
}

export interface TeleprompterSettings {
  fontFamily: string;
  fontSize: number;
  scrollSpeed: number;
  scrollSpeedMultiplier: number;
  areaWidth: number;
  areaHeight: number;
  textStartPosition: number;
  textAlignment: TextAlignment;
  textColor: string;
}

export interface Script {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}
