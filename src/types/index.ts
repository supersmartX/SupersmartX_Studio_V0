export type RecordingState = 'idle' | 'countdown' | 'recording' | 'paused' | 'completed';

export type TabType = 'studio' | 'library' | 'insights';

export type HeaderTab = 'studio' | 'script' | 'camera' | 'audio';

export type TextAlignment = 'left' | 'center' | 'right';

export type AspectRatio = '16:9' | '9:16' | '4:3' | '1:1';

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
