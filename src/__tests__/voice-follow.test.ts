// Voice speech-follow teleprompter — pure-core unit tests (CR-002, Phase 5).
// Covers: tokenizer normalization, conservative forward-only matching,
// interim stability, hold-on-mismatch, pause/mute holds, restart backoff,
// blocked recovery, and the script-end path.

import { describe, it, expect } from 'vitest';
import {
  createInitialVoiceState,
  findBestMatch,
  isVoiceEngaged,
  reduceVoice,
  tokenizeForMatch,
  DEFAULT_VOICE_CONFIG,
  VOICE_MAX_RESTART_ATTEMPTS,
  VOICE_RESTART_DELAYS_MS,
  type VoiceCoreState,
  type VoiceEffect,
  type VoiceEvent,
} from '@/lib/voice-follow';

const SCRIPT = 'hello world this is my recording script for today';

function freshState(): VoiceCoreState {
  return createInitialVoiceState(tokenizeForMatch(SCRIPT));
}

/** Drive one event and return the next state + collected effects. */
function step(state: VoiceCoreState, event: VoiceEvent, seen: VoiceEffect[] = []) {
  const result = reduceVoice(state, event);
  seen.push(...result.effects);
  return { state: result.state, effects: result.effects };
}

/** ENABLE + REC_STARTED → listening, ready for transcripts. */
function listening(): VoiceCoreState {
  let s = freshState();
  s = step(s, { type: 'ENABLE' }).state;
  s = step(s, { type: 'REC_STARTED' }).state;
  return s;
}

describe('tokenizeForMatch', () => {
  it('lowercases, trims edge punctuation, keeps contractions', () => {
    const tokens = tokenizeForMatch('"Hello," don\'t stop…');
    expect(tokens.map((t) => t.norm)).toEqual(['hello', "don't", 'stop']);
  });

  it('splits hyphen-like separators into spoken tokens', () => {
    const tokens = tokenizeForMatch('well-known fact');
    expect(tokens.map((t) => t.norm)).toEqual(['well', 'known', 'fact']);
  });

  it('preserves char offsets into the raw source', () => {
    const raw = '  Hi   there ';
    const tokens = tokenizeForMatch(raw);
    expect(tokens).toHaveLength(2);
    expect(raw.slice(tokens[0].start, tokens[0].end)).toBe('Hi');
    expect(raw.slice(tokens[1].start, tokens[1].end)).toBe('there');
  });

  it('returns no tokens for empty or punctuation-only input', () => {
    expect(tokenizeForMatch('')).toEqual([]);
    expect(tokenizeForMatch('   ')).toEqual([]);
    expect(tokenizeForMatch('!!! ... ???')).toEqual([]);
  });

  it('keeps non-Latin letters (Devanagari) as tokens', () => {
    const tokens = tokenizeForMatch('नमस्ते दुनिया');
    expect(tokens.map((t) => t.norm)).toEqual(['नमस्ते', 'दुनिया']);
  });
});

describe('findBestMatch', () => {
  const scriptTokens = tokenizeForMatch(SCRIPT);

  it('matches from the start when the cursor is -1', () => {
    const best = findBestMatch(scriptTokens, tokenizeForMatch('hello world'), -1, 5);
    expect(best).toEqual({ start: 0, run: 2 });
  });

  it('is forward-only: never matches behind the cursor', () => {
    // cursor sits at 'world' (index 1); the segment is the already-spoken
    // beginning — there is no forward occurrence, so nothing matches.
    const best = findBestMatch(scriptTokens, tokenizeForMatch('hello'), 1, 5);
    expect(best).toBeNull();
  });

  it('tolerates small forward gaps up to the lookahead bound', () => {
    // cursor at 'hello' (0); 'my' is at index 4 — gap 3 <= lookahead 5.
    const best = findBestMatch(scriptTokens, tokenizeForMatch('my recording'), 0, 5);
    expect(best).toEqual({ start: 4, run: 2 });
  });

  it('rejects gaps beyond the lookahead bound', () => {
    // 'today' is the last token (index 8): start 9 > cursor+1+lookahead.
    const best = findBestMatch(scriptTokens, tokenizeForMatch('today'), 1, 5);
    expect(best).toBeNull();
  });

  it('returns null on non-matching speech', () => {
    const best = findBestMatch(scriptTokens, tokenizeForMatch('completely different words'), -1, 5);
    expect(best).toBeNull();
  });

  it('prefers the longest run even when a shorter one is closer', () => {
    // cursor 0 ('x'): start 1 gives a 1-run, start 4 gives a 2-run — the
    // longer run wins despite being further ahead.
    const tokens = tokenizeForMatch('x a y b a b c');
    const best = findBestMatch(tokens, tokenizeForMatch('a b'), 0, 5);
    expect(best).toEqual({ start: 4, run: 2 });
  });

  it('breaks equal-length ties toward the cursor (closest start)', () => {
    // Two identical 2-runs ('a b' at 1 and at 5) — the closer one wins.
    const tokens = tokenizeForMatch('x a b y a b z');
    const best = findBestMatch(tokens, tokenizeForMatch('a b'), 0, 5);
    expect(best).toEqual({ start: 1, run: 2 });
  });
});

describe('transcript handling — conservative forward-only advancement', () => {
  it('final match advances the cursor and emits a scroll effect', () => {
    const seen: VoiceEffect[] = [];
    const { state, effects } = step(listening(), { type: 'TRANSCRIPT', text: 'hello world', kind: 'final' }, seen);
    expect(state.cursor).toBe(1);
    expect(effects).toEqual([{ type: 'scrollToToken', tokenIndex: 1 }]);
  });

  it('single adjacent final word commits (direct continuation)', () => {
    let s = listening();
    s = step(s, { type: 'TRANSCRIPT', text: 'hello', kind: 'final' }).state;
    expect(s.cursor).toBe(0);
    s = step(s, { type: 'TRANSCRIPT', text: 'world', kind: 'final' }).state;
    expect(s.cursor).toBe(1);
  });

  it('holds on non-matching speech — no movement, no effects', () => {
    let s = listening();
    s = step(s, { type: 'TRANSCRIPT', text: 'hello world', kind: 'final' }).state;
    const { state, effects } = step(s, { type: 'TRANSCRIPT', text: 'banana phone signal', kind: 'final' });
    expect(state.cursor).toBe(s.cursor);
    expect(effects).toEqual([]);
  });

  it('never moves the cursor backwards across a transcript sequence', () => {
    let s = listening();
    const sequence: Array<[string, 'interim' | 'final']> = [
      ['hello world', 'interim'],
      ['hello world', 'interim'],
      ['hello world', 'final'],
      ['this is', 'final'],
      ['hello world', 'final'], // stale replay of earlier words
      ['recording script for today', 'final'],
    ];
    let previous = s.cursor;
    for (const [text, kind] of sequence) {
      s = step(s, { type: 'TRANSCRIPT', text, kind }).state;
      expect(s.cursor).toBeGreaterThanOrEqual(previous);
      previous = s.cursor;
    }
    expect(s.cursor).toBe(8);
  });

  it('interim requires stability: first sighting holds, second commits', () => {
    let s = listening();
    let r = step(s, { type: 'TRANSCRIPT', text: 'hello world', kind: 'interim' });
    expect(r.state.cursor).toBe(-1);
    expect(r.effects).toEqual([]);
    r = step(r.state, { type: 'TRANSCRIPT', text: 'hello world', kind: 'interim' });
    expect(r.state.cursor).toBe(1);
    expect(r.effects).toEqual([{ type: 'scrollToToken', tokenIndex: 1 }]);
  });

  it('short interims (below minRun) never commit, even repeated', () => {
    let s = listening();
    for (let i = 0; i < 5; i++) {
      s = step(s, { type: 'TRANSCRIPT', text: 'hello', kind: 'interim' }).state;
    }
    expect(s.cursor).toBe(-1);
  });

  it('an interim candidate that changes resets the stability count', () => {
    let s = listening();
    s = step(s, { type: 'TRANSCRIPT', text: 'hello world', kind: 'interim' }).state;
    // different candidate (run starts elsewhere) → count restarts
    s = step(s, { type: 'TRANSCRIPT', text: 'world this', kind: 'interim' }).state;
    expect(s.cursor).toBe(-1);
    // stale interim after a final is cleared by the final itself
    s = step(s, { type: 'TRANSCRIPT', text: 'hello world', kind: 'final' }).state;
    expect(s.cursor).toBe(1);
    expect(s.pending).toBeNull();
  });

  it('clamps a single event to maxAdvancePerEvent (no wild jumping)', () => {
    const cfg = { ...DEFAULT_VOICE_CONFIG, maxAdvancePerEvent: 3 };
    let s = createInitialVoiceState(tokenizeForMatch(SCRIPT));
    s = reduceVoice(s, { type: 'ENABLE' }, cfg).state;
    s = reduceVoice(s, { type: 'REC_STARTED' }, cfg).state;
    const r = reduceVoice(s, { type: 'TRANSCRIPT', text: SCRIPT, kind: 'final' }, cfg);
    expect(r.state.cursor).toBe(2); // -1 + maxAdvancePerEvent(3) clamped
  });

  it('advancing to the final token emits scrollToEnd exactly once', () => {
    let s = listening();
    const last = tokenizeForMatch(SCRIPT).length - 1;
    const first = step(s, { type: 'TRANSCRIPT', text: SCRIPT, kind: 'final' });
    expect(first.state.cursor).toBe(last);
    expect(first.effects).toEqual([{ type: 'scrollToEnd' }]);
    expect(first.state.scriptEndEmitted).toBe(true);
    // later events re-match nothing forward → no duplicate scrollToEnd
    const second = step(first.state, { type: 'TRANSCRIPT', text: 'today', kind: 'final' });
    expect(second.effects).toEqual([]);
  });
});

describe('holds: mute, pause, disabled', () => {
  it('transcripts are ignored while muted', () => {
    let s = listening();
    s = step(s, { type: 'MUTE', muted: true }).state;
    expect(s.phase).toBe('hold');
    const r = step(s, { type: 'TRANSCRIPT', text: 'hello world', kind: 'final' });
    expect(r.state.cursor).toBe(-1);
    expect(r.effects).toEqual([]);
  });

  it('mute stops recognition; unmute restarts it', () => {
    let s = listening();
    let r = step(s, { type: 'MUTE', muted: true });
    expect(r.effects).toEqual([{ type: 'stopRecognition' }]);
    r = step(r.state, { type: 'MUTE', muted: false });
    expect(r.effects).toEqual([{ type: 'startRecognition' }]);
    expect(r.state.phase).toBe('starting');
  });

  it('pause holds and stops recognition; resume restarts', () => {
    let s = listening();
    let r = step(s, { type: 'PAUSE', paused: true });
    expect(r.state.phase).toBe('hold');
    expect(r.effects).toEqual([{ type: 'stopRecognition' }]);
    r = step(r.state, { type: 'PAUSE', paused: false });
    expect(r.effects).toEqual([{ type: 'startRecognition' }]);
  });

  it('mute while paused does not double-start on unmute', () => {
    let s = listening();
    s = step(s, { type: 'PAUSE', paused: true }).state;
    s = step(s, { type: 'MUTE', muted: true }).state;
    const r = step(s, { type: 'MUTE', muted: false });
    expect(r.effects).toEqual([]); // still paused → stay in hold
    expect(r.state.phase).toBe('hold');
  });

  it('DISABLE stops recognition and disengages', () => {
    let s = listening();
    const r = step(s, { type: 'DISABLE' });
    expect(r.effects).toEqual([{ type: 'stopRecognition' }]);
    expect(r.state.phase).toBe('off');
    expect(isVoiceEngaged(r.state)).toBe(false);
  });
});

describe('state machine: lifecycle, errors, restarts', () => {
  it('ENABLE while muted starts in hold without starting recognition', () => {
    let s = freshState();
    s = step(s, { type: 'MUTE', muted: true }).state;
    const r = step(s, { type: 'ENABLE' });
    expect(r.effects).toEqual([]);
    expect(r.state.phase).toBe('hold');
    expect(r.state.enabled).toBe(true);
  });

  it('ENABLE → starting + startRecognition; REC_STARTED → listening', () => {
    let s = freshState();
    let r = step(s, { type: 'ENABLE' });
    expect(r.effects).toEqual([{ type: 'startRecognition' }]);
    expect(r.state.phase).toBe('starting');
    r = step(r.state, { type: 'REC_STARTED' });
    expect(r.state.phase).toBe('listening');
    expect(isVoiceEngaged(r.state)).toBe(true);
  });

  it('fatal recognition error → blocked + stop, no restart', () => {
    let s = listening();
    const r = step(s, { type: 'REC_ERROR', name: 'not-allowed' });
    expect(r.state.phase).toBe('blocked');
    expect(r.effects).toEqual([{ type: 'stopRecognition' }]);
    expect(isVoiceEngaged(r.state)).toBe(true); // position stays frozen, timed driver still idle
  });

  it('transient error → recovering with 500ms backoff, position untouched', () => {
    let s = listening();
    s = step(s, { type: 'TRANSCRIPT', text: 'hello', kind: 'final' }).state;
    const r = step(s, { type: 'REC_ERROR', name: 'no-speech' });
    expect(r.state.phase).toBe('recovering');
    expect(r.effects).toEqual([{ type: 'scheduleRestart', delayMs: VOICE_RESTART_DELAYS_MS[0] }]);
    expect(r.state.cursor).toBe(0);
  });

  it('backs off 500 → 1000 → 2000 and blocks past the attempt cap', () => {
    let s = listening();
    const delays: number[] = [];
    for (let attempt = 1; attempt <= VOICE_MAX_RESTART_ATTEMPTS; attempt++) {
      const r = step(s, { type: 'REC_ENDED' });
      expect(r.state.phase).toBe('recovering');
      const effect = r.effects[0];
      if (effect?.type !== 'scheduleRestart') throw new Error('expected scheduleRestart');
      delays.push(effect.delayMs);
      s = r.state;
      // restart succeeds
      s = step(s, { type: 'REC_STARTED' }).state;
    }
    expect(delays).toEqual([500, 1000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000]);
    // one more failure without transcript evidence → blocked
    const r = step(s, { type: 'REC_ENDED' });
    expect(r.state.phase).toBe('blocked');
    expect(r.effects).toEqual([{ type: 'stopRecognition' }]);
  });

  it('transcript evidence resets the restart budget', () => {
    let s = listening();
    for (let i = 0; i < VOICE_MAX_RESTART_ATTEMPTS; i++) s = step(s, { type: 'REC_ENDED' }).state;
    s = step(s, { type: 'REC_STARTED' }).state;
    s = step(s, { type: 'TRANSCRIPT', text: 'hello', kind: 'final' }).state;
    expect(s.restartAttempts).toBe(0);
    const r = step(s, { type: 'REC_ENDED' });
    expect(r.state.phase).toBe('recovering'); // not blocked
  });

  it('blocked recovers when the user re-toggles (DISABLE → ENABLE)', () => {
    let s = listening();
    s = step(s, { type: 'REC_ERROR', name: 'not-allowed' }).state;
    expect(s.phase).toBe('blocked');
    s = step(s, { type: 'DISABLE' }).state;
    const r = step(s, { type: 'ENABLE' });
    expect(r.state.phase).toBe('starting');
    expect(r.effects).toEqual([{ type: 'startRecognition' }]);
  });

  it('REC_ENDED after DISABLE is ignored', () => {
    let s = listening();
    s = step(s, { type: 'DISABLE' }).state;
    const r = step(s, { type: 'REC_ENDED' });
    expect(r.effects).toEqual([]);
    expect(r.state.phase).toBe('off');
  });

  it('AVAILABLE false parks the machine as unavailable', () => {
    let s = freshState();
    const r = step(s, { type: 'AVAILABLE', available: false });
    expect(r.state.phase).toBe('unavailable');
    expect(isVoiceEngaged(r.state)).toBe(false);
    // ENABLE while unavailable is a no-op
    const r2 = step(r.state, { type: 'ENABLE' });
    expect(r2.state.phase).toBe('unavailable');
    expect(r2.effects).toEqual([]);
  });
});

describe('script lifecycle', () => {
  it('RESET resyncs the cursor to the top without touching the phase', () => {
    let s = listening();
    s = step(s, { type: 'TRANSCRIPT', text: 'hello world', kind: 'final' }).state;
    expect(s.cursor).toBe(1);
    const r = step(s, { type: 'RESET' });
    expect(r.state.cursor).toBe(-1);
    expect(r.state.phase).toBe('listening');
    expect(r.effects).toEqual([]);
    // following transcript starts over from the beginning
    const r2 = step(r.state, { type: 'TRANSCRIPT', text: 'hello world', kind: 'final' });
    expect(r2.state.cursor).toBe(1);
  });

  it('SET_SCRIPT clamps the cursor into the new script (never backwards-explodes)', () => {
    let s = listening();
    s = step(s, { type: 'TRANSCRIPT', text: 'hello world this is', kind: 'final' }).state;
    expect(s.cursor).toBe(3); // tokens 0..3 committed (commitTo 4 − 1)
    s = step(s, { type: 'SET_SCRIPT', tokens: tokenizeForMatch('hello world') }).state;
    expect(s.cursor).toBe(1); // clamped to the new last token
    expect(s.tokens.map((t) => t.norm)).toEqual(['hello', 'world']);
  });

  it('SET_SCRIPT with an empty script parks the cursor at -1', () => {
    let s = listening();
    s = step(s, { type: 'SET_SCRIPT', tokens: [] }).state;
    expect(s.cursor).toBe(-1);
    // no tokens → nothing can ever match → hold by construction
    const r = step(s, { type: 'TRANSCRIPT', text: 'anything at all', kind: 'final' });
    expect(r.effects).toEqual([]);
  });
});
