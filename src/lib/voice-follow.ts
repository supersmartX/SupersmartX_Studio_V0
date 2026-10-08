// Voice speech-follow teleprompter — pure core (CR-002, FC-1.1 Phase 5,
// owner-approved 2026-10-07).
//
// The user's spoken words are matched against the displayed script and the
// teleprompter advances to the spoken position. Properties required by the
// contract:
//   - conservative: advancement requires real token evidence (commit
//     thresholds below); when speech does not match, the position HOLDS.
//   - forward-only: the cursor never moves backwards — no wild jumping.
//   - pauses hold: no transcript events means no scroll effects at all.
//   - local only: no network, no LLM, no third-party service — token
//     alignment in this module. Browser SpeechRecognition is wired in
//     `src/hooks/useVoiceFollow.ts`, never here.
//
// This module is intentionally DOM-free and browser-API-free so the whole
// behaviour space is unit-testable.

export interface ScriptToken {
  /** Lowercased, edge-punctuation-trimmed comparison form. */
  norm: string;
  /** Inclusive char offset of the token in the raw source string. */
  start: number;
  /** Exclusive char offset of the token in the raw source string. */
  end: number;
}

export interface VoiceFollowConfig {
  /** K — how far ahead (in script tokens) a match may start from the cursor. */
  lookahead: number;
  /** L — minimum consecutive matched tokens for an interim commit. */
  minRun: number;
  /** Consecutive identical interim matches required before committing. */
  interimStability: number;
  /** Sanity bound on advancement produced by a single transcript event. */
  maxAdvancePerEvent: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceFollowConfig = {
  lookahead: 5,
  minRun: 2,
  interimStability: 2,
  maxAdvancePerEvent: 120,
};

/** Consecutive restart cycles allowed without any transcript evidence. */
export const VOICE_MAX_RESTART_ATTEMPTS = 10;

/** Backoff schedule (ms) for restart attempts 1..n (capped at the last). */
export const VOICE_RESTART_DELAYS_MS = [500, 1000, 2000] as const;

// Zero-width characters (U+200B–U+200D, U+FEFF) are built programmatically
// so this source file contains no invisible characters.
const ZERO_WIDTH_CHARS = String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff);

// Edge trimming for a raw whitespace chunk: quotes, dashes, brackets,
// ellipses, CJK/Indic sentence punctuation, zero-width characters. Internal
// characters (including apostrophes inside contractions) are preserved.
const LEADING_EDGE_RE = new RegExp(
  `^[\\s"'‘’“”.,!?;:…\\-–—()[\\]{}<>${ZERO_WIDTH_CHARS}।]+`
);
const TRAILING_EDGE_RE = new RegExp(
  `[\\s"'‘’“”.,!?;:…\\-–—()[\\]{}<>${ZERO_WIDTH_CHARS}।]+$`
);

// Hyphen-like separators split one written word into the separate spoken
// tokens a recognizer emits ("well-known" → "well" + "known").
const HYPHEN_SPLIT_RE = /([-–—])/;

/**
 * Tokenize free text into match tokens with char offsets into `text`.
 * Whitespace splits, hyphen-like separators split, edge punctuation trims,
 * everything lowercases. Unicode letters (e.g. Devanagari) are kept as-is
 * apart from edge trimming, so non-Latin scripts still produce tokens.
 */
export function tokenizeForMatch(text: string): ScriptToken[] {
  const tokens: ScriptToken[] = [];
  if (!text) return tokens;
  for (const match of text.matchAll(/\S+/g)) {
    const chunk = match[0];
    const base = match.index ?? 0;
    let segStart = 0;
    for (const part of chunk.split(HYPHEN_SPLIT_RE)) {
      if (part === '-' || part === '–' || part === '—') {
        segStart += part.length;
        continue;
      }
      if (!part) continue;
      const norm = part.replace(LEADING_EDGE_RE, '').replace(TRAILING_EDGE_RE, '').toLowerCase();
      if (norm) {
        tokens.push({ norm, start: base + segStart, end: base + segStart + part.length });
      }
      segStart += part.length;
    }
  }
  return tokens;
}

export interface MatchCandidate {
  /** First script token index of the match. */
  start: number;
  /** Number of consecutive matching tokens. */
  run: number;
}

/**
 * Conservative forward-only matcher: try match starts in
 * [cursor+1, cursor+1+K] and keep the longest run (ties prefer the start
 * closest to the cursor). Returns null when nothing matches — callers HOLD.
 */
export function findBestMatch(
  scriptTokens: ScriptToken[],
  segmentTokens: ScriptToken[],
  cursor: number,
  lookahead: number,
): MatchCandidate | null {
  if (segmentTokens.length === 0 || scriptTokens.length === 0) return null;
  const from = Math.max(cursor + 1, 0);
  const to = Math.min(cursor + 1 + lookahead, scriptTokens.length - 1);
  let best: MatchCandidate | null = null;
  for (let start = from; start <= to; start++) {
    let run = 0;
    while (
      start + run < scriptTokens.length &&
      run < segmentTokens.length &&
      scriptTokens[start + run].norm === segmentTokens[run].norm
    ) {
      run++;
    }
    if (run > 0 && (!best || run > best.run)) best = { start, run };
  }
  return best;
}

export type VoiceFollowPhase =
  | 'unavailable'
  | 'off'
  | 'starting'
  | 'listening'
  | 'hold'
  | 'recovering'
  | 'blocked';

export interface VoiceCoreState {
  available: boolean;
  phase: VoiceFollowPhase;
  /** Token index of the display script the matches align against. */
  tokens: ScriptToken[];
  /** Last confirmed script token; -1 = nothing matched yet. Never decreases. */
  cursor: number;
  /** Interim candidate awaiting stability confirmation. */
  pending: MatchCandidate | null;
  pendingCount: number;
  muted: boolean;
  paused: boolean;
  enabled: boolean;
  /** Restart cycles scheduled since the last transcript evidence. */
  restartAttempts: number;
  scriptEndEmitted: boolean;
}

export type VoiceEvent =
  | { type: 'AVAILABLE'; available: boolean }
  | { type: 'ENABLE' }
  | { type: 'DISABLE' }
  | { type: 'REC_STARTED' }
  | { type: 'TRANSCRIPT'; text: string; kind: 'interim' | 'final' }
  | { type: 'REC_ERROR'; name: string }
  | { type: 'REC_ENDED' }
  | { type: 'MUTE'; muted: boolean }
  | { type: 'PAUSE'; paused: boolean }
  | { type: 'RESET' }
  | { type: 'SET_SCRIPT'; tokens: ScriptToken[] };

export type VoiceEffect =
  | { type: 'startRecognition' }
  | { type: 'stopRecognition' }
  | { type: 'scheduleRestart'; delayMs: number }
  | { type: 'scrollToToken'; tokenIndex: number }
  | { type: 'scrollToEnd' };

export interface VoiceReduceResult {
  state: VoiceCoreState;
  effects: VoiceEffect[];
}

export function createInitialVoiceState(
  tokens: ScriptToken[] = [],
  available = true,
): VoiceCoreState {
  return {
    available,
    phase: available ? 'off' : 'unavailable',
    tokens,
    cursor: -1,
    pending: null,
    pendingCount: 0,
    muted: false,
    paused: false,
    enabled: false,
    restartAttempts: 0,
    scriptEndEmitted: false,
  };
}

/** Fatal recognition errors: no restart, wait for the user. */
const FATAL_RECOGNITION_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'language-not-supported',
]);

function restartDelay(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), VOICE_RESTART_DELAYS_MS.length - 1);
  return VOICE_RESTART_DELAYS_MS[idx];
}

/**
 * The voice-follow state machine. Pure: same (state, event) → same result.
 * Side effects are returned as data; the hook executes them.
 */
export function reduceVoice(
  state: VoiceCoreState,
  event: VoiceEvent,
  config: VoiceFollowConfig = DEFAULT_VOICE_CONFIG,
): VoiceReduceResult {
  const effects: VoiceEffect[] = [];
  let next: VoiceCoreState = { ...state };

  switch (event.type) {
    case 'AVAILABLE': {
      next.available = event.available;
      if (!event.available) {
        next.enabled = false;
        next.phase = 'unavailable';
        if (state.phase !== 'unavailable' && state.phase !== 'off') {
          effects.push({ type: 'stopRecognition' });
        }
      } else if (state.phase === 'unavailable') {
        next.phase = 'off';
      }
      break;
    }

    case 'ENABLE': {
      if (!state.available) {
        next.phase = 'unavailable';
        break;
      }
      if (state.enabled) break;
      next.enabled = true;
      next.cursor = -1;
      next.pending = null;
      next.pendingCount = 0;
      next.restartAttempts = 0;
      next.scriptEndEmitted = false;
      if (state.muted || state.paused) {
        next.phase = 'hold';
      } else {
        next.phase = 'starting';
        effects.push({ type: 'startRecognition' });
      }
      break;
    }

    case 'DISABLE': {
      if (!state.enabled && state.phase === 'off') break;
      next.enabled = false;
      next.phase = state.available ? 'off' : 'unavailable';
      next.pending = null;
      next.pendingCount = 0;
      effects.push({ type: 'stopRecognition' });
      break;
    }

    case 'REC_STARTED': {
      if (!state.enabled) break;
      // Deliberately does NOT reset restartAttempts: only transcript
      // evidence does (below). A browser that keeps starting and ending
      // without producing results must still reach the blocked cap instead
      // of restarting forever.
      next.phase = state.muted || state.paused ? 'hold' : 'listening';
      break;
    }

    case 'TRANSCRIPT': {
      // Only the live, audible, unpaused path may advance the position.
      if (!state.enabled || state.muted || state.paused) break;
      if (state.phase !== 'listening' && state.phase !== 'recovering') break;

      // Any delivered transcript is evidence the service is alive — the
      // restart budget only counts silent/failed cycles.
      next.restartAttempts = 0;

      const segment = tokenizeForMatch(event.text);
      const best = findBestMatch(state.tokens, segment, state.cursor, config.lookahead);

      if (!best) {
        // No evidence → hold. A final result also invalidates any pending
        // interim candidate so stale halves of a sentence never commit.
        if (event.kind === 'final') {
          next.pending = null;
          next.pendingCount = 0;
        }
        break;
      }

      let commitTo = -1;
      if (event.kind === 'final') {
        next.pending = null;
        next.pendingCount = 0;
        const adjacent = best.start === state.cursor + 1;
        // Finals commit on a direct adjacent continuation (single words are
        // strong evidence at exactly the next position) or a full minRun.
        if (best.run >= config.minRun || (best.run >= 1 && adjacent)) {
          commitTo = best.start + best.run;
        }
      } else {
        if (
          state.pending &&
          state.pending.start === best.start &&
          state.pending.run === best.run
        ) {
          next.pendingCount = state.pendingCount + 1;
        } else {
          next.pending = best;
          next.pendingCount = 1;
        }
        // Interims commit only after the same candidate is seen twice AND
        // the run clears minRun — short/noisy interims never move anything.
        if (best.run >= config.minRun && next.pendingCount >= config.interimStability) {
          commitTo = best.start + best.run;
        }
      }

      if (commitTo > state.cursor) {
        const newCursor = Math.min(commitTo - 1, state.cursor + config.maxAdvancePerEvent);
        if (newCursor > state.cursor) {
          next.cursor = newCursor;
          next.restartAttempts = 0;
          next.pending = null;
          next.pendingCount = 0;
          if (newCursor === state.tokens.length - 1 && !state.scriptEndEmitted) {
            next.scriptEndEmitted = true;
            effects.push({ type: 'scrollToEnd' });
          } else {
            effects.push({ type: 'scrollToToken', tokenIndex: newCursor });
          }
        }
      }
      break;
    }

    case 'REC_ERROR': {
      if (!state.enabled) break;
      if (FATAL_RECOGNITION_ERRORS.has(event.name)) {
        next.phase = 'blocked';
        next.pending = null;
        next.pendingCount = 0;
        effects.push({ type: 'stopRecognition' });
        break;
      }
      // Transient (no-speech / aborted / network / audio-capture): bounded
      // restart with backoff; position untouched throughout.
      if (state.muted || state.paused) {
        next.phase = 'hold';
        effects.push({ type: 'stopRecognition' });
        break;
      }
      const attempt = state.restartAttempts + 1;
      next.restartAttempts = attempt;
      if (attempt > VOICE_MAX_RESTART_ATTEMPTS) {
        next.phase = 'blocked';
        next.pending = null;
        next.pendingCount = 0;
        effects.push({ type: 'stopRecognition' });
      } else {
        next.phase = 'recovering';
        effects.push({ type: 'scheduleRestart', delayMs: restartDelay(attempt) });
      }
      break;
    }

    case 'REC_ENDED': {
      // The browser ends recognition routinely after silence. Restart only
      // while we are meant to be listening; stop paths ignore this event.
      if (!state.enabled || state.muted || state.paused) break;
      if (state.phase === 'blocked' || state.phase === 'off' || state.phase === 'unavailable') {
        break;
      }
      const attempt = state.restartAttempts + 1;
      next.restartAttempts = attempt;
      if (attempt > VOICE_MAX_RESTART_ATTEMPTS) {
        next.phase = 'blocked';
        next.pending = null;
        next.pendingCount = 0;
        effects.push({ type: 'stopRecognition' });
      } else {
        next.phase = 'recovering';
        effects.push({ type: 'scheduleRestart', delayMs: restartDelay(attempt) });
      }
      break;
    }

    case 'MUTE': {
      if (state.muted === event.muted) break;
      next.muted = event.muted;
      if (!state.enabled) break;
      if (event.muted) {
        // Mute means "not heard": hold the position AND stop listening.
        next.phase = 'hold';
        next.pending = null;
        next.pendingCount = 0;
        effects.push({ type: 'stopRecognition' });
      } else if (!state.paused) {
        next.phase = 'starting';
        effects.push({ type: 'startRecognition' });
      }
      break;
    }

    case 'PAUSE': {
      if (state.paused === event.paused) break;
      next.paused = event.paused;
      if (!state.enabled) break;
      if (event.paused) {
        next.phase = 'hold';
        next.pending = null;
        next.pendingCount = 0;
        effects.push({ type: 'stopRecognition' });
      } else if (!state.muted) {
        next.phase = 'starting';
        effects.push({ type: 'startRecognition' });
      }
      break;
    }

    case 'RESET': {
      // A new take resets the scroll to the top; resync the cursor so the
      // matcher follows from the beginning again.
      next.cursor = -1;
      next.pending = null;
      next.pendingCount = 0;
      next.scriptEndEmitted = false;
      next.restartAttempts = 0;
      break;
    }

    case 'SET_SCRIPT': {
      next.tokens = event.tokens;
      next.cursor = event.tokens.length === 0 ? -1 : Math.min(state.cursor, event.tokens.length - 1);
      next.pending = null;
      next.pendingCount = 0;
      next.scriptEndEmitted = false;
      break;
    }
  }

  return { state: next, effects };
}

/**
 * Whether the timed scroll driver must stay inert because the voice driver
 * owns the position. Blocked keeps the position frozen on purpose — the user
 * explicitly switches back to timed scroll (toggle off) to resume it.
 */
export function isVoiceEngaged(state: VoiceCoreState): boolean {
  return state.enabled && state.phase !== 'off' && state.phase !== 'unavailable';
}
