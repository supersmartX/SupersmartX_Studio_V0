// Browser adapter for the Web Speech API (CR-002, Phase 5).
//
// Native SpeechRecognition / webkitSpeechRecognition only — no third-party
// speech service, no server-side audio upload, no dependency. TypeScript's
// lib.dom does not declare these interfaces, so the minimal structural
// types live here instead of a global augmentation (keeps this file the
// single owner of the browser contract and avoids duplicate-identifier
// risk against future lib.dom updates).

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  0: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  /** DOMException name, e.g. 'not-allowed', 'no-speech', 'network'. */
  name: string;
  message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface WindowWithSpeechRecognition {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

/**
 * Returns the browser's recognition constructor, or null where unsupported
 * (e.g. Firefox, insecure contexts). SSR-safe.
 */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithSpeechRecognition;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Create a configured recognition instance. `lang` defaults to the browser
 * locale (the recognition language policy for v1 — matching is against the
 * user's own script tokens, so the script should be written in the language
 * the browser recognizes).
 */
export function createRecognition(): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
  return rec;
}

/** Detach handlers before stopping so stop-initiated events are ignored. */
export function silenceRecognition(rec: SpeechRecognitionLike | null): void {
  if (!rec) return;
  rec.onstart = null;
  rec.onresult = null;
  rec.onerror = null;
  rec.onend = null;
  try {
    rec.abort();
  } catch {
    // abort() throws only if the instance is already stopped — harmless.
  }
}
