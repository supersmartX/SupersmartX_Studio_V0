export type RecordingState = 'idle' | 'countdown' | 'recording' | 'paused' | 'completed';

export type TabType = 'studio' | 'library' | 'insights';

export type HeaderTab = 'studio' | 'script' | 'camera' | 'audio';

export type TextAlignment = 'left' | 'center' | 'right';

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
