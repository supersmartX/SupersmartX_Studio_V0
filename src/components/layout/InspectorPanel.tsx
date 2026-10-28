'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { TeleprompterSettings, TextAlignment } from '@/types';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CloseIcon, ChevronDownIcon } from '@/components/icons';
import { FONT_FAMILIES } from '@/constants';
import { InspirationLoader } from '@/components/editor/InspirationLoader';
import type { VoiceFollowPhase } from '@/lib/voice-follow';

/** Voice speech-follow control state (CR-002) — rendered only when visible. */
export interface VoiceFollowOption {
  visible: boolean;
  enabled: boolean;
  onChange: (checked: boolean) => void;
  phase: VoiceFollowPhase;
}

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
  /** Opens the pricing flow — used by the teleprompter script-limit notice. */
  onUpgradeClick: () => void;
  teleprompterNotice?: string | null;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
  /** Renders the panel as an overlay drawer instead of a docked aside. */
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  inspectorContext?: InspectorContext;
  /** Voice speech-follow control (CR-002) — Creator + supported browsers. */
  voiceFollow?: VoiceFollowOption;
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
  onUpgradeClick,
  teleprompterNotice,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
  isDrawer = false,
  isOpen = true,
  onClose,
  inspectorContext,
  voiceFollow,
}: InspectorPanelProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  // Focus restoration: remember what opened the drawer so focus can go back
  // there on close (UX-012 — never strand the keyboard cursor).
  const invokerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const queryFocusables = useCallback((root: HTMLElement) =>
    Array.from(
      root.querySelectorAll<HTMLElement>(
        // [data-focus-skip] opts a control out of initial focus (the drawer's
        // Close button) so opening never lands the cursor on "leave".
        'button:not([data-focus-skip]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ), []);

  const restoreFocus = (el: HTMLElement | null) => {
    if (el && document.contains(el)) el.focus();
  };

  // Enter/exit focus management — keyed only on isOpen so unrelated re-renders
  // (typing in the script, collapsing sections) never steal focus.
  useEffect(() => {
    if (!isDrawer) return;

    // The close branch must run even if the drawer node is already gone.
    // Otherwise a transient open→closed mount (compact first paint starts
    // "open", then the layout effect closes it) can leave `wasOpenRef` true,
    // and the NEXT open skips focusing the drawer. Keyboard focus then stays on
    // the toggle outside the dialog, so Escape never reaches the drawer handler
    // and the panel becomes a keyboard dead end.
    if (!isOpen) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        restoreFocus(invokerRef.current);
        invokerRef.current = null;
      }
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      invokerRef.current = document.activeElement as HTMLElement | null;
    }

    // Focus just after the opening click's event dispatch. Focusing inside that
    // dispatch let the clicked trigger steal focus straight back, so the dialog
    // opened while keyboard events (including Escape) still targeted the trigger
    // outside it. A short delay also gets past the `invisible` → visible
    // transition: focusing a still-hidden node is a silent no-op.
    const timer = window.setTimeout(() => {
      const drawer = drawerRef.current;
      if (!drawer || drawer.contains(document.activeElement)) return;
      queryFocusables(drawer)[0]?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [isDrawer, isOpen, queryFocusables]);

  // If the drawer unmounts while open, send focus back to its invoker.
  useEffect(() => () => {
    if (wasOpenRef.current) restoreFocus(invokerRef.current);
  }, []);

  // Tab trap — focusables are RE-QUERIED on every keydown: collapsing a
  // section unmounts nodes, so a stale first/last pair would silently let Tab
  // escape the trap.
  useEffect(() => {
    if (!isDrawer || !isOpen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const els = queryFocusables(drawer);
      if (els.length === 0) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus(); }
      else if (!drawer.contains(active)) { e.preventDefault(); firstEl.focus(); }
    };
    drawer.addEventListener('keydown', handleKeyDown);
    return () => drawer.removeEventListener('keydown', handleKeyDown);
  }, [isDrawer, isOpen, onClose, queryFocusables]);

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
      onUpgradeClick={onUpgradeClick}
      teleprompterNotice={teleprompterNotice}
      script={script}
      onScriptChange={onScriptChange}
      onClearScript={onClearScript}
      wordCount={wordCount}
      progress={progress}
      onLoadInspiration={onLoadInspiration}
      inspectorContext={inspectorContext}
      voiceFollow={voiceFollow}
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
  // Review collapses for the same reason: every panel section is prepare-only, so
  // the drawer would render as an empty titled "Publish" region — a false
  // affordance. Review keeps its own canvas hierarchy (RECORDING READY → Export).
  //
  // On desktop the aside still reserves its CURRENT width while receded. If it
  // were unmounted, its 300px would be handed to the canvas at the exact moment
  // the countdown begins, and the camera would visibly jump larger (and shrink
  // again on Stop). Keeping the empty column means the frame the user framed
  // is the frame that records. Compact layouts are an overlay drawer and have
  // no geometry to preserve.
  if (inspectorContext === 'recording' || inspectorContext === 'review') {
    if (isDrawer) return null;
    return (
      <aside
        aria-hidden="true"
        className={`hidden xl:block h-full shrink-0 overflow-hidden transition-all duration-[180ms] ease-out ${
          isOpen ? 'w-[300px]' : 'w-0'
        }`}
      />
    );
  }

  // Compact (< 1280px): full-height slide-in drawer from the right, over the canvas.
  // Wide (>= 1280px): inline aside that shares the row with the IconRail.
  if (isDrawer) {
    return (
      <>
        {/* Purely a pointer convenience: it dismisses the drawer on tap. The
            same outcome is available to everyone else via Escape and the
            "Toggle inspector panel" button, so it is removed from the
            accessibility tree — matching the Modal backdrop. */}
        {isOpen && (
          <div
            className="fixed inset-0 z-drawer drawer-backdrop animate-fade-in"
            onClick={onClose}
            aria-hidden="true"
          />
        )}
        <div
          ref={drawerRef}
          className={`fixed top-0 right-0 h-full w-[85vw] max-w-[360px] bg-surface border-l border-border-default shadow-2xl z-drawer flex flex-col overflow-hidden transition-all duration-[180ms] ease-out ${
            // `invisible` (kept visible through the exit transition by
            // transition-all) removes the closed drawer from the tab order and
            // the accessibility tree — it must not linger as an off-screen,
            // tabbable, aria-modal dialog.
            isOpen ? 'translate-x-0' : 'translate-x-full invisible'
          }`}
          role={isOpen ? 'dialog' : undefined}
          aria-modal={isOpen ? true : undefined}
          aria-label="Inspector panel"
        >
          <PanelHeader label={headerLabel} onClose={onClose} />
          <InspectorScrollArea>{content}</InspectorScrollArea>
        </div>
      </>
    );
  }

  // Desktop: inline aside panel — respects isOpen so the Settings icon
  // beside Profile (Header) and the compact menu's Settings actually open/close it.
  // Uses CSS transition for smooth spatial continuity (180ms ease-out).
  return (
    <aside
      className={`hidden xl:flex h-full border-l border-border-subtle bg-surface flex-col shrink-0 overflow-hidden transition-all duration-[180ms] ease-out ${
        // `invisible` pairs with aria-hidden so the collapsed panel's clipped
        // controls leave the tab order too (aria-hidden + focusable = violation).
        isOpen ? 'w-[300px] opacity-100' : 'w-0 opacity-0 border-l-0 invisible'
      }`}
      aria-label="Inspector panel"
      aria-hidden={!isOpen}
    >
      <PanelHeader label={headerLabel} onClose={onClose} />
      <InspectorScrollArea>{content}</InspectorScrollArea>
    </aside>
  );
}

/**
 * UX-009 (scroll affordance). The Prepare panel stacks Script → Teleprompter →
 * Camera and is taller than the viewport on a 1084px-tall window, so it scrolls
 * with no visual cue that anything exists above or below the fold.
 *
 * This wraps the shared content in a non-scrolling positioned frame with a
 * scrolling child, then fades the appropriate edge only while content actually
 * remains on that side. Deliberately zero-height decoration: the audit forbids
 * adding whitespace to the studio shell, so the cue is painted on the edges it
 * describes rather than reserved with a sticky bar.
 *
 * The frames are stacked absolutely OUTSIDE the scroller on purpose — inside it
 * they would scroll away with the content and describe nothing.
 */
function InspectorScrollArea({ children }: { children: React.ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 1px tolerance: fractional layout heights make scrollTop land on 0.5.
    setAtTop(el.scrollTop <= 1);
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= 1);
  }, []);

  // Collapse/expand changes the content height without firing a scroll event,
  // so the edges are re-measured when the content box resizes — a ResizeObserver
  // instead of running on every unrelated render (typing, toggles).
  useEffect(() => {
    syncEdges();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncEdges());
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [syncEdges]);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollerRef} onScroll={syncEdges} className="h-full overflow-y-auto">
        <div ref={contentRef}>{children}</div>
      </div>
      {!atTop && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-surface to-transparent"
        />
      )}
      {!atBottom && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-surface to-transparent"
        />
      )}
    </div>
  );
}

function PanelHeader({ label, onClose }: { label: string; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
      <span className="text-body-sm font-semibold text-text-primary">{label}</span>
      {onClose && (
        <button
          onClick={onClose}
          // data-focus-skip: opening the drawer must not land focus on "leave".
          data-focus-skip=""
          className="p-2 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close inspector"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/** Phase → hint copy for the Voice follow toggle (CR-002). */
function describeVoiceFollow(v: VoiceFollowOption): string {
  if (v.phase === 'blocked') {
    return 'Speech recognition unavailable — the position stays frozen. Turn this off to resume timed scrolling.';
  }
  if (!v.enabled) {
    return 'Speak your script — the prompter follows your words. Pauses hold the position; it never jumps.';
  }
  if (v.phase === 'hold') {
    return 'Holding — the position advances again once you speak (and are not muted or paused).';
  }
  if (v.phase === 'listening') {
    return 'Listening — the prompter follows your speech.';
  }
  return 'Starting speech recognition…';
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
  onUpgradeClick,
  teleprompterNotice,
  script,
  onScriptChange,
  onClearScript,
  wordCount,
  progress,
  onLoadInspiration,
  inspectorContext,
  voiceFollow,
}: {
  settings: TeleprompterSettings;
  updateSettings: (partial: Partial<TeleprompterSettings>) => void;
  focusViewEnabled: boolean;
  onFocusViewToggle: () => void;
  mirrorCamera: boolean;
  onMirrorCameraToggle: () => void;
  countdownEnabled: boolean;
  onCountdownToggle: () => void;
  onUpgradeClick: () => void;
  teleprompterNotice?: string | null;
  script: string;
  onScriptChange: (value: string) => void;
  onClearScript: () => void;
  wordCount: number;
  progress: number;
  onLoadInspiration: (key: string) => void;
  inspectorContext?: InspectorContext;
  voiceFollow?: VoiceFollowOption;
}) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    // Match the current creation phase immediately (no open-then-collapse flash).
    switch (inspectorContext) {
      case 'recording':
        return { script: true, teleprompter: true, camera: true };
      case 'review':
        return { script: true, teleprompter: true, camera: true };
      default:
        return { script: false, teleprompter: false, camera: true };
    }
  });
  // Clearing the script discards the user's draft, so it asks first — through
  // the shared ConfirmDialog, like every other destructive action.
  const [confirmClearScript, setConfirmClearScript] = useState(false);

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
      // available but collapsed (camera/mic switching lives in the transport's device chips).
      preparing: { script: false, teleprompter: false, camera: true },
      // Recording: camera is the only surface — everything collapses.
      recording: { script: true, teleprompter: true, camera: true },
      // Review: the take exists; platform/output config lives on the Canvas switcher.
      review: { script: true, teleprompter: true, camera: true },
    };
    setCollapsedSections((prev) => ({ ...prev, ...phasePresets[inspectorContext] }));
  }, [inspectorContext]);

  const showScript = inspectorContext === 'preparing';
  const showTeleprompter = inspectorContext === 'preparing';
  const showCamera = inspectorContext === 'preparing';

  return (
    <div className="p-4 flex flex-col gap-5">
      {/* SCRIPT Section — only during preparing */}
      {showScript && (<>
      <Card>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => toggleSection('script')}
            className="group flex items-center justify-between w-full text-left min-h-[44px] px-2 -mx-2 rounded-md transition-colors hover:bg-elevated"
            aria-expanded={!collapsedSections.script}
          >
            {/* span, not h3: headings are flow content and are invalid inside
                <button>; the button's own accessible name carries the label. */}
            <span className="text-caption font-semibold text-text-secondary">Script</span>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-text-secondary transition-transform ${collapsedSections.script ? '-rotate-90' : ''}`} />
          </button>

          {!collapsedSections.script && (<>
          <div className="flex items-center justify-between">
            <span className="text-caption text-text-secondary">{wordCount} words</span>
            <span className="text-caption text-text-secondary">{Math.round(progress)}% of target</span>
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
            className="w-full min-h-[120px] bg-elevated border border-border-subtle rounded-lg p-3 text-body-sm text-text-primary placeholder-text-muted resize-none outline-none focus:border-accent transition-colors leading-relaxed"
            placeholder="Paste or write your script here..."
            aria-label="Script Editor"
          />

          <div className="flex items-center justify-between">
            <span className="text-caption text-text-secondary flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Saved locally
            </span>
            <button
              onClick={() => {
                if (script.trim()) {
                  setConfirmClearScript(true);
                  return;
                }
                onClearScript();
              }}
              className="relative inline-flex items-center min-h-[24px] text-caption text-text-secondary hover:text-text-primary transition-colors after:absolute after:-inset-x-2 after:-inset-y-[11px] after:content-['']"
              suppressHydrationWarning
            >
              Clear
            </button>
          </div>

          {/* UX-002 (item 6): the reassurance that used to sit on the camera
              setup overlay now sits with the editor that earns it. Kept factual
              on purpose — the script is written to this browser's localStorage
              by useScriptStorage, so it survives a reload on this device and
              nothing more. No cloud, no sync, no account recovery implied. */}
          <p className="text-overline leading-relaxed text-text-muted">
            Your script is saved in this browser, so you can close the tab and pick up
            where you left off. Clearing site data removes it.
          </p>

          <InspirationLoader onLoad={onLoadInspiration} hasExistingScript={!!script.trim()} />
          </>)}
        </div>
      </Card>
      </>)}

      {showTeleprompter && showScript && <div className="h-px bg-border-subtle" />}

      {/* TELEPROMPTER Section — only during preparing */}
      {showTeleprompter && (
      <Card>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => toggleSection('teleprompter')}
            className="group flex items-center justify-between w-full text-left min-h-[44px] px-2 -mx-2 rounded-md transition-colors hover:bg-elevated"
            aria-expanded={!collapsedSections.teleprompter}
          >
            <span className="text-caption font-semibold text-text-secondary">Teleprompter</span>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-text-secondary transition-transform ${collapsedSections.teleprompter ? '-rotate-90' : ''}`} />
          </button>

          {!collapsedSections.teleprompter && (<>

          {teleprompterNotice && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated border border-border-subtle">
              <span className="text-caption text-text-secondary leading-snug">{teleprompterNotice}</span>
              {teleprompterNotice.includes('limit reached') && (
                <button
                  onClick={onUpgradeClick}
                  className="shrink-0 ml-auto px-3 min-h-[40px] rounded-md bg-accent/20 text-accent-text text-overline font-semibold hover:bg-accent/30 transition-colors"
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

          {/* Voice speech-follow (CR-002) — only when entitled (Creator)
              AND the browser exposes SpeechRecognition; the row is absent
              otherwise (Free/Guest/unsupported never see a dead control). */}
          {voiceFollow?.visible && (
            <Toggle
              checked={voiceFollow.enabled}
              onChange={voiceFollow.onChange}
              label="Voice follow"
              description={describeVoiceFollow(voiceFollow)}
            />
          )}

          {/* Position */}
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm text-text-secondary">Position</span>
            <div className="flex gap-1" role="group" aria-label="Text alignment">
              {(['left', 'center', 'right'] as TextAlignment[]).map((align) => (
                <button
                  key={align}
                  onClick={() => updateSettings({ textAlignment: align })}
                  aria-label={`Align ${align}`}
                  aria-pressed={settings.textAlignment === align}
                  className={`flex-1 flex items-center justify-center min-h-[40px] py-2 rounded-lg border text-xs font-medium transition-all ${
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
            <span className="text-body-sm text-text-secondary">Text Color</span>
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

      {/* PLATFORM Section — intentionally absent.
          The review view owns platform selection through the single "Preview as"
          switcher on the Canvas; a second selector here made two controls fight
          over the same state and hid the launch matrix. */}

      {showCamera && (
      <Card>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => toggleSection('camera')}
            className="group flex items-center justify-between w-full text-left min-h-[44px] px-2 -mx-2 rounded-md transition-colors hover:bg-elevated"
            aria-expanded={!collapsedSections.camera}
          >
            <span className="text-caption font-semibold text-text-secondary">Camera &amp; Preview</span>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-text-secondary transition-transform ${collapsedSections.camera ? '-rotate-90' : ''}`} />
          </button>

          {!collapsedSections.camera && (<>
          {/* Device picking no longer lives in the inspector (and the old
              DeviceSelectorBar row is gone too): it is behind the mic / camera
              chevrons in the transport bar. Repeating the device lists here
              would mean two controls writing the same state, so this section
              only owns preview behaviour. */}
          <p className="text-overline text-text-muted">
            Switch camera or microphone from the transport bar under the canvas.
          </p>

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

      <ConfirmDialog
        isOpen={confirmClearScript}
        title="Clear your script?"
        message="This removes the script draft saved in this browser. It cannot be undone."
        confirmLabel="Clear script"
        onConfirm={() => {
          setConfirmClearScript(false);
          onClearScript();
        }}
        onCancel={() => setConfirmClearScript(false)}
      />
    </div>
  );
}
