'use client';

import type { TeleprompterSettings, TextAlignment } from '@/types';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import { CloseIcon } from '@/components/icons';
import { FONT_FAMILIES } from '@/constants';
import { InspirationLoader } from '@/components/editor/InspirationLoader';

interface InspectorPanelProps {
  settings: TeleprompterSettings;
  onSettingsChange: (settings: TeleprompterSettings) => void;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  mirrorCamera: boolean;
  onMirrorCameraToggle: () => void;
  countdownEnabled: boolean;
  onCountdownToggle: () => void;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  onVideoDeviceChange: (deviceId: string) => void;
  onAudioDeviceChange: (deviceId: string) => void;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export function InspectorPanel({
  settings,
  onSettingsChange,
  focusViewEnabled,
  onFocusViewToggle,
  mirrorCamera,
  onMirrorCameraToggle,
  countdownEnabled,
  onCountdownToggle,
  videoDevices,
  audioDevices,
  selectedVideoDevice,
  selectedAudioDevice,
  onVideoDeviceChange,
  onAudioDeviceChange,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
  isMobile = false,
  isOpen = true,
  onClose,
}: InspectorPanelProps) {
  const updateSettings = (partial: Partial<TeleprompterSettings>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  if (isMobile) {
    return (
      <>
        {isOpen && (
          <div className="fixed inset-0 z-[150] drawer-backdrop animate-fade-in" onClick={onClose} />
        )}
        <div
          className={`fixed top-0 right-0 h-full w-[85vw] max-w-[360px] bg-surface border-l border-border-default shadow-2xl z-[160] flex flex-col overflow-hidden transition-transform duration-250 ease-out ${
            isOpen ? 'translate-x-0 animate-slide-in-right' : 'translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Inspector panel"
        >
          <MobileContent
            settings={settings}
            updateSettings={updateSettings}
            focusViewEnabled={focusViewEnabled}
            onFocusViewToggle={onFocusViewToggle}
            mirrorCamera={mirrorCamera}
            onMirrorCameraToggle={onMirrorCameraToggle}
            countdownEnabled={countdownEnabled}
            onCountdownToggle={onCountdownToggle}
            videoDevices={videoDevices}
            audioDevices={audioDevices}
            selectedVideoDevice={selectedVideoDevice}
            selectedAudioDevice={selectedAudioDevice}
            onVideoDeviceChange={onVideoDeviceChange}
            onAudioDeviceChange={onAudioDeviceChange}
            script={script}
            onScriptChange={onScriptChange}
            onClearScript={onClearScript}
            wordCount={wordCount}
            progress={progress}
            onLoadInspiration={onLoadInspiration}
            onClose={onClose}
          />
        </div>
      </>
    );
  }

  return (
    <aside className="w-[280px] lg:w-[300px] h-full border-l border-border-subtle bg-surface flex flex-col shrink-0 overflow-hidden" aria-label="Inspector panel">
      <DesktopContent
        settings={settings}
        updateSettings={updateSettings}
        focusViewEnabled={focusViewEnabled}
        onFocusViewToggle={onFocusViewToggle}
        mirrorCamera={mirrorCamera}
        onMirrorCameraToggle={onMirrorCameraToggle}
        countdownEnabled={countdownEnabled}
        onCountdownToggle={onCountdownToggle}
        videoDevices={videoDevices}
        audioDevices={audioDevices}
        selectedVideoDevice={selectedVideoDevice}
        selectedAudioDevice={selectedAudioDevice}
        onVideoDeviceChange={onVideoDeviceChange}
        onAudioDeviceChange={onAudioDeviceChange}
        script={script}
        onScriptChange={onScriptChange}
        onClearScript={onClearScript}
        wordCount={wordCount}
        progress={progress}
        onLoadInspiration={onLoadInspiration}
        onClose={onClose}
      />
    </aside>
  );
}

function MobileContent({
  settings,
  updateSettings,
  focusViewEnabled,
  onFocusViewToggle,
  mirrorCamera,
  onMirrorCameraToggle,
  countdownEnabled,
  onCountdownToggle,
  videoDevices,
  audioDevices,
  selectedVideoDevice,
  selectedAudioDevice,
  onVideoDeviceChange,
  onAudioDeviceChange,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
  onClose,
}: {
  settings: TeleprompterSettings;
  updateSettings: (partial: Partial<TeleprompterSettings>) => void;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  mirrorCamera: boolean;
  onMirrorCameraToggle: () => void;
  countdownEnabled: boolean;
  onCountdownToggle: () => void;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  onVideoDeviceChange: (deviceId: string) => void;
  onAudioDeviceChange: (deviceId: string) => void;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-primary">Inspector</span>
          <button
            onClick={onClose!}
            className="p-2 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close inspector"
          >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <InspectorContent
          settings={settings}
          updateSettings={updateSettings}
          focusViewEnabled={focusViewEnabled}
          onFocusViewToggle={onFocusViewToggle}
          mirrorCamera={mirrorCamera}
          onMirrorCameraToggle={onMirrorCameraToggle}
          countdownEnabled={countdownEnabled}
          onCountdownToggle={onCountdownToggle}
          videoDevices={videoDevices}
          audioDevices={audioDevices}
          selectedVideoDevice={selectedVideoDevice}
          selectedAudioDevice={selectedAudioDevice}
          onVideoDeviceChange={onVideoDeviceChange}
          onAudioDeviceChange={onAudioDeviceChange}
          script={script}
          onScriptChange={onScriptChange}
          onClearScript={onClearScript}
          wordCount={wordCount}
          progress={progress}
          onLoadInspiration={onLoadInspiration}
        />
      </div>
    </>
  );
}

function DesktopContent({
  settings,
  updateSettings,
  focusViewEnabled,
  onFocusViewToggle,
  mirrorCamera,
  onMirrorCameraToggle,
  countdownEnabled,
  onCountdownToggle,
  videoDevices,
  audioDevices,
  selectedVideoDevice,
  selectedAudioDevice,
  onVideoDeviceChange,
  onAudioDeviceChange,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
  onClose,
}: {
  settings: TeleprompterSettings;
  updateSettings: (partial: Partial<TeleprompterSettings>) => void;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  mirrorCamera: boolean;
  onMirrorCameraToggle: () => void;
  countdownEnabled: boolean;
  onCountdownToggle: () => void;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  onVideoDeviceChange: (deviceId: string) => void;
  onAudioDeviceChange: (deviceId: string) => void;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-primary">Inspector</span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors"
            aria-label="Close inspector"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <InspectorContent
          settings={settings}
          updateSettings={updateSettings}
          focusViewEnabled={focusViewEnabled}
          onFocusViewToggle={onFocusViewToggle}
          mirrorCamera={mirrorCamera}
          onMirrorCameraToggle={onMirrorCameraToggle}
          countdownEnabled={countdownEnabled}
          onCountdownToggle={onCountdownToggle}
          videoDevices={videoDevices}
          audioDevices={audioDevices}
          selectedVideoDevice={selectedVideoDevice}
          selectedAudioDevice={selectedAudioDevice}
          onVideoDeviceChange={onVideoDeviceChange}
          onAudioDeviceChange={onAudioDeviceChange}
          script={script}
          onScriptChange={onScriptChange}
          onClearScript={onClearScript}
          wordCount={wordCount}
          progress={progress}
          onLoadInspiration={onLoadInspiration}
        />
      </div>
    </>
  );
}

function InspectorContent({
  settings,
  updateSettings,
  focusViewEnabled,
  onFocusViewToggle,
  mirrorCamera,
  onMirrorCameraToggle,
  countdownEnabled,
  onCountdownToggle,
  videoDevices,
  audioDevices,
  selectedVideoDevice,
  selectedAudioDevice,
  onVideoDeviceChange,
  onAudioDeviceChange,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
}: {
  settings: TeleprompterSettings;
  updateSettings: (partial: Partial<TeleprompterSettings>) => void;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  mirrorCamera: boolean;
  onMirrorCameraToggle: () => void;
  countdownEnabled: boolean;
  onCountdownToggle: () => void;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  selectedAudioDevice: string;
  onVideoDeviceChange: (deviceId: string) => void;
  onAudioDeviceChange: (deviceId: string) => void;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
}) {
  return (
    <div className="p-4 flex flex-col gap-5">
      {/* TELEPROMPTER Section */}
      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Teleprompter</h3>

          <Select
            label="Font Family"
            value={settings.fontFamily}
            onChange={(value) => updateSettings({ fontFamily: value })}
            options={FONT_FAMILIES.flatMap((group) =>
              group.options.map((opt) => ({
                value: opt.value,
                label: opt.label,
                group: group.group,
              }))
            )}
          />

          <Slider
            label="Font Size"
            value={settings.fontSize}
            min={18}
            max={52}
            unit="px"
            onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value, 10) })}
          />

          <Slider
            label="Width"
            value={Math.round((settings.areaWidth / 800) * 100)}
            min={40}
            max={100}
            unit="%"
            onChange={(e) => updateSettings({ areaWidth: Math.round((parseInt(e.target.value, 10) / 100) * 800) })}
          />

          <Slider
            label="Scroll Speed"
            value={settings.scrollSpeedMultiplier}
            min={0.5}
            max={2.0}
            step={0.1}
            unit="x"
            onChange={(e) => updateSettings({ scrollSpeedMultiplier: parseFloat(e.target.value) })}
          />

          {/* Position */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] text-text-secondary">Position</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as TextAlignment[]).map((align) => (
                <button
                  key={align}
                  onClick={() => updateSettings({ textAlignment: align })}
                  className={`flex-1 flex items-center justify-center py-2 rounded-lg border text-xs font-medium transition-all ${
                    settings.textAlignment === align
                      ? 'bg-accent/15 text-accent border-accent/30'
                      : 'bg-elevated text-text-muted border-border-subtle hover:text-text-secondary hover:border-border-default'
                  }`}
                >
                  {align === 'left' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" d="M4 6h16M4 12h10M4 18h14" />
                    </svg>
                  )}
                  {align === 'center' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" d="M4 6h16M7 12h10M5 18h14" />
                    </svg>
                  )}
                  {align === 'right' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" d="M4 6h16M10 12h10M6 18h14" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Text Color */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">Text Color</span>
            <input
              type="color"
              value={settings.textColor}
              onChange={(e) => updateSettings({ textColor: e.target.value })}
              className="w-8 h-8 rounded-md border border-border-subtle cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none"
              aria-label="Text color"
            />
          </div>
        </div>
      </Card>

      <div className="h-px bg-border-subtle" />

      {/* RECORDING Section */}
      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Recording</h3>

          <Select
            label="Camera"
            value={selectedVideoDevice}
            onChange={onVideoDeviceChange}
            options={videoDevices.map((d) => ({
              value: d.deviceId,
              label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
            }))}
          />

          <Select
            label="Microphone"
            value={selectedAudioDevice}
            onChange={onAudioDeviceChange}
            options={audioDevices.map((d) => ({
              value: d.deviceId,
              label: d.label || `Mic ${d.deviceId.slice(0, 8)}`,
            }))}
          />

          <Toggle
            checked={mirrorCamera}
            onChange={onMirrorCameraToggle}
            label="Mirror Camera"
            description="Flip camera preview horizontally."
          />

          <Toggle
            checked={focusViewEnabled}
            onChange={onFocusViewToggle}
            label="Show Focus View"
            description="Soften preview while keeping recording clear."
          />

          <Toggle
            checked={countdownEnabled}
            onChange={onCountdownToggle}
            label="Countdown"
            description="Show 3-2-1 countdown before recording."
          />
        </div>
      </Card>

      <div className="h-px bg-border-subtle" />

      {/* SCRIPT Section */}
      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Script</h3>

          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">{wordCount} words</span>
            <span className="text-[10px] text-text-muted">{Math.round(progress)}% of target</span>
          </div>

          <div className="w-full h-1.5 bg-border-default rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <textarea
            value={script}
            onChange={(e) => onScriptChange(e.target.value)}
            className="w-full min-h-[120px] bg-elevated border border-border-subtle rounded-lg p-3 text-[13px] text-text-primary placeholder-text-muted resize-none outline-none focus:border-accent transition-colors leading-relaxed"
            placeholder="Paste or write your script here..."
            aria-label="Script Editor"
          />

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Saved locally
            </span>
            <button
              onClick={onClearScript}
              className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"
            >
              Clear
            </button>
          </div>

          <InspirationLoader onLoad={onLoadInspiration} />
        </div>
      </Card>
    </div>
  );
}
