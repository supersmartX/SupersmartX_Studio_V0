'use client';

import { useState, useRef, useEffect } from 'react';
import type { TeleprompterSettings, TextAlignment, AspectRatio, PlatformId } from '@/types';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import { CloseIcon, ChevronDownIcon } from '@/components/icons';
import { FONT_FAMILIES } from '@/constants';
import { InspirationLoader } from '@/components/editor/InspirationLoader';
import { PlatformSelector } from '@/components/studio/PlatformSelector';
import { CustomFormat } from '@/components/studio/CustomFormat';

// The surrounding app signals which creation phase is active so the Inspector
// can show only the sections relevant to that phase (progressive disclosure).
export type InspectorContext = 'preparing' | 'recording' | 'review';

// The contextual right panel adapts its header and content to the current
// creation phase. This avoids the "control panel" feeling where every tool
// competes for attention simultaneously.

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
  platformId: PlatformId;
  onPlatformChange: (id: PlatformId) => void;
  userPlan: string;
  isAuthenticated: boolean;
  onUpgradeRequired: (platformId?: PlatformId) => void;
  teleprompterNotice?: string | null;
  customAspectRatio: AspectRatio;
  onCustomAspectRatioChange: (ratio: AspectRatio) => void;
  customWidth: number;
  onCustomWidthChange: (w: number) => void;
  customHeight: number;
  onCustomHeightChange: (h: number) => void;
  aspectRatio: AspectRatio;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  inspectorContext?: InspectorContext;
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
  platformId,
  onPlatformChange,
  userPlan,
  isAuthenticated,
  onUpgradeRequired,
  teleprompterNotice,
  customAspectRatio,
  onCustomAspectRatioChange,
  customWidth,
  onCustomWidthChange,
  customHeight,
  onCustomHeightChange,
  aspectRatio,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
  isMobile = false,
  isOpen = true,
  onClose,
  inspectorContext,
}: InspectorPanelProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    const focusableEls = drawer.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];

    firstEl?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl?.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl?.focus(); }
    };
    drawer.addEventListener('keydown', handleKeyDown);
    return () => drawer.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, isOpen, onClose]);

  const updateSettings = (partial: Partial<TeleprompterSettings>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  const content = (
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
      platformId={platformId}
      onPlatformChange={onPlatformChange}
      userPlan={userPlan}
      isAuthenticated={isAuthenticated}
      onUpgradeRequired={onUpgradeRequired}
      teleprompterNotice={teleprompterNotice}
      customAspectRatio={customAspectRatio}
      onCustomAspectRatioChange={onCustomAspectRatioChange}
      customWidth={customWidth}
      onCustomWidthChange={onCustomWidthChange}
      customHeight={customHeight}
      onCustomHeightChange={onCustomHeightChange}
      aspectRatio={aspectRatio}
      script={script}
      onScriptChange={onScriptChange}
      onClearScript={onClearScript}
      wordCount={wordCount}
      progress={progress}
      onLoadInspiration={onLoadInspiration}
      inspectorContext={inspectorContext}
    />
  );

  // Contextual panel header based on the creation phase — the header changes
  // meaning rather than the panel changing position. This is what makes the
  // UI feel sophisticated rather than "tool-heavy".
  const headerLabel =
    inspectorContext === 'recording' ? 'Recording'
    : inspectorContext === 'review' ? 'Publish'
    : 'Prepare';

  // While a take is live, the camera canvas is the only surface the user needs —
  // the disposal panel recedes entirely so it never competes with the recording.
  if (inspectorContext === 'recording') return null;

  // Mobile: full-height slide-in drawer from right
  // Tablet: bottom sheet overlay (60vh)
  // Desktop: inline aside panel
  if (isMobile) {
    return (
      <>
        {isOpen && (
          <div className="fixed inset-0 z-drawer drawer-backdrop animate-fade-in" onClick={onClose} />
        )}
        <div
          ref={drawerRef}
          className={`fixed top-0 right-0 h-full w-[85vw] max-w-[360px] bg-surface border-l border-border-default shadow-2xl z-drawer flex flex-col overflow-hidden transition-all duration-[180ms] ease-out ${
            isOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Inspector panel"
        >
          <PanelHeader label={headerLabel} onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto">
            {content}
          </div>
        </div>
      </>
    );
  }

  // Desktop: inline aside panel — respects isOpen so the Settings icon
  // beside Profile (Header) and BottomNav Settings actually open/close it.
  // Uses CSS transition for smooth spatial continuity (180ms ease-out).
  return (
    <aside
      className={`hidden lg:flex h-full border-l border-border-subtle bg-surface flex-col shrink-0 overflow-hidden transition-all duration-[180ms] ease-out ${
        isOpen ? 'w-[280px] xl:w-[300px] opacity-100' : 'w-0 opacity-0 border-l-0'
      }`}
      aria-label="Inspector panel"
      aria-hidden={!isOpen}
    >
      <PanelHeader label={headerLabel} onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {content}
      </div>
    </aside>
  );
}

function PanelHeader({ label, onClose }: { label: string; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
      <span className="text-[13px] font-semibold text-text-primary">{label}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="p-2 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close inspector"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      )}
    </div>
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
  platformId,
  onPlatformChange,
  userPlan,
  isAuthenticated,
  onUpgradeRequired,
  teleprompterNotice,
  customAspectRatio,
  onCustomAspectRatioChange,
  customWidth,
  onCustomWidthChange,
  customHeight,
  onCustomHeightChange,
  aspectRatio,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
  inspectorContext,
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
  platformId: PlatformId;
  onPlatformChange: (id: PlatformId) => void;
  userPlan: string;
  isAuthenticated: boolean;
  onUpgradeRequired: (platformId?: PlatformId) => void;
  teleprompterNotice?: string | null;
  customAspectRatio: AspectRatio;
  onCustomAspectRatioChange: (ratio: AspectRatio) => void;
  customWidth: number;
  onCustomWidthChange: (w: number) => void;
  customHeight: number;
  onCustomHeightChange: (h: number) => void;
  aspectRatio: AspectRatio;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
  inspectorContext?: InspectorContext;
}) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    // Match the current creation phase immediately (no open-then-collapse flash).
    switch (inspectorContext) {
      case 'recording':
        return { script: true, teleprompter: true, camera: true, platform: true };
      case 'review':
        return { script: true, teleprompter: true, camera: true, platform: false };
      default:
        return { script: false, teleprompter: false, camera: true, platform: true };
    }
  });

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Progressive disclosure: each creation phase shows the sections that matter and
  // collapses the rest. Runs only when the phase CHANGES, so manual toggles within a
  // phase are preserved.
  useEffect(() => {
    if (!inspectorContext) return;
    const phasePresets: Record<InspectorContext, Record<string, boolean>> = {
      // Preparing: script + teleprompter are the primary inputs. Camera config stays
      // available but collapsed (camera/mic switching lives in the DeviceSelectorBar).
      preparing: { script: false, teleprompter: false, camera: true, platform: true },
      // Recording: camera is the only surface — everything collapses.
      recording: { script: true, teleprompter: true, camera: true, platform: true },
      // Review: the take exists → platform/output config becomes the focus.
      review: { script: true, teleprompter: true, camera: true, platform: false },
    };
    setCollapsedSections((prev) => ({ ...prev, ...phasePresets[inspectorContext] }));
  }, [inspectorContext]);

  const showScript = inspectorContext === 'preparing';
  const showTeleprompter = inspectorContext === 'preparing';
  const showPlatform = inspectorContext === 'review';
  const showCamera = inspectorContext === 'preparing';

  return (
    <div className="p-4 flex flex-col gap-5">
      {/* SCRIPT Section — only during preparing */}
      {showScript && (<>
      <Card>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => toggleSection('script')}
            className="flex items-center justify-between w-full text-left"
            aria-expanded={!collapsedSections.script}
          >
            <h3 className="text-[12px] font-semibold text-text-secondary">Script</h3>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-text-secondary transition-transform ${collapsedSections.script ? '-rotate-90' : ''}`} />
          </button>

          {!collapsedSections.script && (<>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">{wordCount} words</span>
            <span className="text-[12px] text-text-secondary">{Math.round(progress)}% of target</span>
          </div>

          <div
            className="w-full h-1.5 bg-border-default rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Script progress: ${Math.round(progress)}%`}
          >
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
            <span className="text-[12px] text-text-secondary flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Saved locally
            </span>
            <button
              onClick={() => {
                if (script.trim() && !window.confirm('Clear your script? This cannot be undone.')) return;
                onClearScript();
              }}
              className="text-[12px] text-text-secondary hover:text-text-primary transition-colors"
              suppressHydrationWarning
            >
              Clear
            </button>
          </div>

          <InspirationLoader onLoad={onLoadInspiration} hasExistingScript={!!script.trim()} />
          </>)}
        </div>
      </Card>
      </>)}

      {showTeleprompter && showScript && <div className="h-px bg-border-subtle" />}

      {/* TELEPROMPTER Section — only during preparing */}
      {showTeleprompter && (
      <Card>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => toggleSection('teleprompter')}
            className="flex items-center justify-between w-full text-left"
            aria-expanded={!collapsedSections.teleprompter}
          >
            <h3 className="text-[12px] font-semibold text-text-secondary">Teleprompter</h3>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-text-secondary transition-transform ${collapsedSections.teleprompter ? '-rotate-90' : ''}`} />
          </button>

          {!collapsedSections.teleprompter && (<>

          {teleprompterNotice && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated border border-border-subtle">
              <span className="text-[12px] text-text-secondary leading-snug">{teleprompterNotice}</span>
              {teleprompterNotice.includes('limit reached') && (
                <button
                  onClick={() => onUpgradeRequired()}
                  className="shrink-0 ml-auto px-2.5 py-1 rounded-md bg-accent/20 text-accent text-[11px] font-semibold hover:bg-accent/30"
                >
                  Upgrade
                </button>
              )}
            </div>
          )}

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
            label="Reading Area Height"
            value={settings.areaHeight}
            min={20}
            max={100}
            unit="%"
            onChange={(e) => updateSettings({ areaHeight: parseInt(e.target.value, 10) })}
          />

          <Slider
            label="Text Start Position"
            value={settings.textStartPosition}
            min={0}
            max={80}
            unit="%"
            onChange={(e) => updateSettings({ textStartPosition: parseInt(e.target.value, 10) })}
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
            <span className="text-[13px] text-text-secondary">Position</span>
            <div className="flex gap-1" role="group" aria-label="Text alignment">
              {(['left', 'center', 'right'] as TextAlignment[]).map((align) => (
                <button
                  key={align}
                  onClick={() => updateSettings({ textAlignment: align })}
                  aria-label={`Align ${align}`}
                  aria-pressed={settings.textAlignment === align}
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
          </>)}
        </div>
      </Card>
      )}

      {(showPlatform && (showScript || showTeleprompter)) && <div className="h-px bg-border-subtle" />}

      {/* PLATFORM Section — only during review */}
      {showPlatform && (
      <Card>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => toggleSection('platform')}
            className="flex items-center justify-between w-full text-left"
            aria-expanded={!collapsedSections.platform}
          >
            <h3 className="text-[12px] font-semibold text-text-secondary">Platform</h3>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-text-secondary transition-transform ${collapsedSections.platform ? '-rotate-90' : ''}`} />
          </button>

          {!collapsedSections.platform && (<>
          <PlatformSelector
            selectedPlatformId={platformId}
            onSelect={onPlatformChange}
            userPlan={userPlan}
            onUpgradeRequired={onUpgradeRequired}
          />

          {platformId === 'custom' && (
            <CustomFormat
              aspectRatio={customAspectRatio}
              width={customWidth}
              height={customHeight}
              onAspectRatioChange={onCustomAspectRatioChange}
              onWidthChange={onCustomWidthChange}
              onHeightChange={onCustomHeightChange}
            />
          )}
          </>)}
        </div>
      </Card>
      )}

      {(showCamera && (showScript || showTeleprompter || showPlatform)) && <div className="h-px bg-border-subtle" />}

      {/* CAMERA Section — available during preparing (collapsed by default) */}
      {showCamera && (
      <Card>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => toggleSection('camera')}
            className="flex items-center justify-between w-full text-left"
            aria-expanded={!collapsedSections.camera}
          >
            <h3 className="text-[12px] font-semibold text-text-secondary">Camera</h3>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-text-secondary transition-transform ${collapsedSections.camera ? '-rotate-90' : ''}`} />
          </button>

          {!collapsedSections.camera && (<>
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
          </>)}
        </div>
      </Card>
      )}
    </div>
  );
}
