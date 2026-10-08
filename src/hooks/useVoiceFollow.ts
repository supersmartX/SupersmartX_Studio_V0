'use client';

// Voice speech-follow teleprompter — React lifecycle adapter (CR-002,
// Phase 5). Executes the pure state machine in `src/lib/voice-follow.ts`
// against the browser's native SpeechRecognition and the teleprompter
// scroll container.
//
// Contract notes:
//   - The recorder/audio pipeline is never touched: this hook only reads
//     flags (muted/paused/script) and writes the prompter container's
//     scrollTop. `useMicMuteSync` remains the single writer for audio
//     tracks (FC-1.1 P0-3).
//   - Script end never stops recording itself: scrolling to the bottom
//     lets the existing geometry check (`checkEndCallback`) fire the
//     frozen DC-2 auto-stop path with its exact toast (FC-1.1 §6 Item 8).

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  createInitialVoiceState,
  isVoiceEngaged,
  reduceVoice,
  tokenizeForMatch,
  DEFAULT_VOICE_CONFIG,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceFollowPhase,
} from '@/lib/voice-follow';
import {
  createRecognition,
  getSpeechRecognitionCtor,
  silenceRecognition,
  type SpeechRecognitionLike,
} from '@/lib/speech-recognition';

export interface UseVoiceFollowOptions {
  /** Raw script text — same string the prompter renders (char offsets align). */
  script: string;
  /** Toggle: creator-entitled AND switched on. */
  enabled: boolean;
  /** Microphone muted — mute means "not heard": hold + stop recognition. */
  muted: boolean;
  /** Recording paused — position must hold (FC-1.1 §6 Item 1 semantics). */
  paused: boolean;
  /** The teleprompter scroll container (`prompterContainerRef`). */
  containerRef: RefObject<HTMLDivElement | null>;
}

export interface UseVoiceFollowResult {
  phase: VoiceFollowPhase;
  /** Browser SpeechRecognition support probe (post-mount). */
  supported: boolean;
  /** True while the voice driver owns the position (timed scroll must idle). */
  engagedRef: RefObject<boolean>;
  /** Resync the cursor (call when the page resets the scroll to top). */
  reset: () => void;
}

export function useVoiceFollow(options: UseVoiceFollowOptions): UseVoiceFollowResult {
  const { script, enabled, muted, paused, containerRef } = options;

  const stateRef = useRef<ReturnType<typeof createInitialVoiceState> | null>(null);
  if (stateRef.current === null) {
    stateRef.current = createInitialVoiceState(tokenizeForMatch(script));
  }

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const engagedRef = useRef(false);
  const scriptRef = useRef(script);
  const [phase, setPhase] = useState<VoiceFollowPhase>(stateRef.current.phase);
  const [supported, setSupported] = useState(false);

  scriptRef.current = script;

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    silenceRecognition(recognitionRef.current);
    recognitionRef.current = null;
  }, []);

  const runEffectsRef = useRef<(effects: VoiceEffect[]) => void>(() => {});

  const dispatch = useCallback((event: VoiceEvent) => {
    const prev = stateRef.current;
    if (!prev) return;
    const { state, effects } = reduceVoice(prev, event, DEFAULT_VOICE_CONFIG);
    stateRef.current = state;
    if (state.phase !== prev.phase) setPhase(state.phase);
    engagedRef.current = isVoiceEngaged(state);
    if (effects.length > 0) runEffectsRef.current(effects);
  }, []);

  const startRecognition = useCallback(() => {
    stopRecognition();
    const rec = createRecognition();
    if (!rec) {
      // Probe said supported but the constructor vanished — treat as unavailable.
      dispatch({ type: 'AVAILABLE', available: false });
      return;
    }
    rec.onstart = () => dispatch({ type: 'REC_STARTED' });
    rec.onresult = (ev) => {
      let finals = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finals += transcript;
        else interim = transcript;
      }
      if (finals.trim()) dispatch({ type: 'TRANSCRIPT', text: finals, kind: 'final' });
      if (interim.trim()) dispatch({ type: 'TRANSCRIPT', text: interim, kind: 'interim' });
    };
    rec.onerror = (ev) => dispatch({ type: 'REC_ERROR', name: ev.name });
    rec.onend = () => dispatch({ type: 'REC_ENDED' });
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      // InvalidStateError (already started) — the onstart/onend cycle owns it.
    }
  }, [stopRecognition, dispatch]);

  const scrollToToken = useCallback(
    (tokenIndex: number) => {
      const container = containerRef.current;
      const token = stateRef.current?.tokens[tokenIndex];
      if (!container || !token) return;
      const inner = container.firstElementChild;
      const textNode = inner?.firstChild ?? null;
      if (!inner || !textNode || textNode.nodeType !== 3) return; // Node.TEXT_NODE
      const text = textNode as Text;
      try {
        const range = document.createRange();
        const offset = Math.min(token.start, text.length);
        range.setStart(text, offset);
        range.setEnd(text, offset);
        const tokenRect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        // Content-coordinate top of the matched token's line…
        const tokenContentTop = tokenRect.top - containerRect.top + container.scrollTop;
        // …minus the reading guide (the script's initial padding-top) so the
        // spoken line sits where the first line sat — minimal, incremental,
        // and never jumping: the timed driver resumes from here on toggle-off.
        const guidePx = parseFloat(window.getComputedStyle(inner).paddingTop) || 0;
        const target = Math.max(0, Math.round(tokenContentTop - guidePx));
        container.scrollTop = target;
      } catch {
        // Layout not ready — hold the current position (conservative).
      }
    },
    [containerRef],
  );

  const scrollToEnd = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // Saturating: the browser clamps past-the-end assignments. The existing
    // checkEndCallback then fires the frozen script-end auto-stop path.
    container.scrollTop = container.scrollHeight;
  }, [containerRef]);

  const runEffects = useCallback(
    (effects: VoiceEffect[]) => {
      for (const effect of effects) {
        switch (effect.type) {
          case 'startRecognition':
            startRecognition();
            break;
          case 'stopRecognition':
            stopRecognition();
            break;
          case 'scheduleRestart':
            if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              restartTimerRef.current = null;
              const s = stateRef.current;
              if (
                s &&
                s.enabled &&
                !s.muted &&
                !s.paused &&
                s.phase !== 'blocked' &&
                s.phase !== 'off' &&
                s.phase !== 'unavailable'
              ) {
                startRecognition();
              }
            }, effect.delayMs);
            break;
          case 'scrollToToken':
            scrollToToken(effect.tokenIndex);
            break;
          case 'scrollToEnd':
            scrollToEnd();
            break;
        }
      }
    },
    [startRecognition, stopRecognition, scrollToToken, scrollToEnd],
  );
  // Assigned during render so the first dispatch (post-mount) always sees
  // the current executor; the assignment is idempotent.
  runEffectsRef.current = runEffects;

  // Browser support probe (after mount — SSR-safe, no hydration mismatch).
  useEffect(() => {
    const available = getSpeechRecognitionCtor() !== null;
    setSupported(available);
    dispatch({ type: 'AVAILABLE', available });
  }, [dispatch]);

  // Keep the matcher aligned with the displayed script (DC-1 safe: the
  // cursor is clamped, never moved backwards).
  useEffect(() => {
    dispatch({ type: 'SET_SCRIPT', tokens: tokenizeForMatch(script) });
  }, [script, dispatch]);

  // Toggle / mute / pause transitions (diffed — events are idempotent).
  const flagsRef = useRef({ enabled: false, muted: false, paused: false });
  useEffect(() => {
    const prev = flagsRef.current;
    const next = { enabled, muted, paused };
    flagsRef.current = next;
    if (prev.enabled !== next.enabled) dispatch({ type: next.enabled ? 'ENABLE' : 'DISABLE' });
    if (prev.muted !== next.muted) dispatch({ type: 'MUTE', muted: next.muted });
    if (prev.paused !== next.paused) dispatch({ type: 'PAUSE', paused: next.paused });
  }, [enabled, muted, paused, dispatch]);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), [dispatch]);

  // Unmount: release recognition and any pending restart.
  useEffect(() => () => stopRecognition(), [stopRecognition]);

  return { phase, supported, engagedRef, reset };
}
