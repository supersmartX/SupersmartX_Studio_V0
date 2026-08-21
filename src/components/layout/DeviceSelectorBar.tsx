'use client';

import { ChevronDownIcon, RefreshIcon } from '@/components/icons';

interface DeviceSelectorBarProps {
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  onVideoDeviceChange: (deviceId: string) => void;
  onAudioDeviceChange: (deviceId: string) => void;
  onRefresh: () => void;
}

export function DeviceSelectorBar({
  videoDevices,
  audioDevices,
  selectedVideoDevice,
  selectedAudioDevice,
  onVideoDeviceChange,
  onAudioDeviceChange,
  onRefresh,
}: DeviceSelectorBarProps) {
  return (
    <div className="h-10 sm:h-10 border-b border-border-subtle bg-surface flex items-center px-3 sm:px-4 gap-2 sm:gap-3 shrink-0">
      <div className="relative min-w-0 flex-1 sm:flex-none sm:w-auto">
        <select
          value={selectedVideoDevice}
          onChange={(e) => onVideoDeviceChange(e.target.value)}
          aria-label="Camera"
          className="w-full sm:w-auto h-9 sm:h-7 bg-elevated border border-border-subtle rounded-md pl-7 pr-6 text-[11px] text-text-secondary appearance-none cursor-pointer outline-none focus:border-accent transition-colors truncate"
          suppressHydrationWarning
        >
          {videoDevices.length === 0 ? (
            <option value="">No camera</option>
          ) : (
            videoDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </option>
            ))
          )}
        </select>
        <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
          <ChevronDownIcon className="w-3 h-3" />
        </div>
      </div>

      <div className="relative min-w-0 flex-1 sm:flex-none sm:w-auto">
        <select
          value={selectedAudioDevice}
          onChange={(e) => onAudioDeviceChange(e.target.value)}
          aria-label="Microphone"
          className="w-full sm:w-auto h-9 sm:h-7 bg-elevated border border-border-subtle rounded-md pl-7 pr-6 text-[11px] text-text-secondary appearance-none cursor-pointer outline-none focus:border-accent transition-colors truncate"
          suppressHydrationWarning
        >
          {audioDevices.length === 0 ? (
            <option value="">No mic</option>
          ) : (
            audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
              </option>
            ))
          )}
        </select>
        <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
          <ChevronDownIcon className="w-3 h-3" />
        </div>
      </div>

      <button
        onClick={onRefresh}
        className="p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 sm:p-1.5 sm:min-w-0 sm:min-h-0"
        aria-label="Refresh devices"
      >
        <RefreshIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
