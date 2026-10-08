// useVoiceFollow integration tests (CR-002, Phase 5).
//
// The pure matching/state logic is covered exhaustively in
// voice-follow.test.ts; this file verifies the React + browser adapter
// layer: support probing, SpeechRecognition lifecycle (start/stop/abort),
// phase reporting, engaged gating for the timed driver, mute/pause holds,
// fatal-error blocking, restart backoff with the DOM event wiring, and
// unmount cleanup — all against a fake native SpeechRecognition.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useVoiceFollow, type UseVoiceFollowResult } from '@/hooks/useVoiceFollow';
import type {
  SpeechRecognitionEventLike,
  SpeechRecognitionErrorEventLike,
} from '@/lib/speech-recognition';

const SCRIPT = 'hello world this is my recording script for today';

class FakeRecognition {
  static instances: FakeRecognition[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  onstart: ((ev: Event) => void) | null = null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: ((ev: Event) => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.startCalls++;
  }

  stop() {
    this.stopCalls++;
  }

  abort() {
    this.abortCalls++;
  }
}

function asRecognitionCtor(): unknown {
  return FakeRecognition;
}

function resultEvent(text: string, isFinal: boolean): SpeechRecognitionEventLike {
  const result = {
    isFinal,
    length: 1,
    0: { transcript: text },
    item: () => ({ transcript: text }),
  };
  return {
    resultIndex: 0,
    results: {
      length: 1,
      0: result,
      item: () => result,
    },
  } as unknown as SpeechRecognitionEventLike;
}

function TestProbe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const { phase, supported, engagedRef, reset }: UseVoiceFollowResult = useVoiceFollow({
    script: SCRIPT,
    enabled,
    muted,
    paused,
    containerRef,
  });

  return (
    <div>
      <button data-testid="enable" onClick={() => setEnabled((v) => !v)}>toggle voice</button>
      <button data-testid="mute" onClick={() => setMuted((v) => !v)}>mute</button>
      <button data-testid="pause" onClick={() => setPaused((v) => !v)}>pause</button>
      <button data-testid="reset" onClick={reset}>reset</button>
      <span data-testid="phase">{phase}</span>
      <span data-testid="supported">{supported ? 'yes' : 'no'}</span>
      <span data-testid="engaged">{engagedRef.current ? 'yes' : 'no'}</span>
      <div data-testid="container" ref={containerRef}>
        <div>{SCRIPT}</div>
      </div>
    </div>
  );
}

function phaseText(): string {
  return screen.getByTestId('phase').textContent ?? '';
}

function engagedText(): string {
  return screen.getByTestId('engaged').textContent ?? '';
}

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition =
    asRecognitionCtor();
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.useRealTimers();
});

describe('useVoiceFollow — browser adapter lifecycle', () => {
  it('probes support after mount and starts in off/disengaged', () => {
    render(<TestProbe />);
    expect(screen.getByTestId('supported').textContent).toBe('yes');
    expect(phaseText()).toBe('off');
    expect(engagedText()).toBe('no');
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('enable creates and starts a recognition instance; onstart → listening + engaged', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));

    expect(FakeRecognition.instances).toHaveLength(1);
    const rec = FakeRecognition.instances[0];
    expect(rec.startCalls).toBe(1);
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(phaseText()).toBe('starting');

    act(() => rec.onstart?.(new Event('start')));
    expect(phaseText()).toBe('listening');
    expect(engagedText()).toBe('yes');
  });

  it('delivers final and interim transcripts without crashing (jsdom layout is inert)', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];

    act(() => {
      rec.onstart?.(new Event('start'));
      rec.onresult?.(resultEvent('hello world', false));
      rec.onresult?.(resultEvent('hello world', true));
      rec.onresult?.(resultEvent('banana phone', true)); // mismatch → holds
    });

    expect(phaseText()).toBe('listening');
    expect(engagedText()).toBe('yes');
  });

  it('mute holds the position and aborts recognition; unmute restarts a fresh instance', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const first = FakeRecognition.instances[0];
    act(() => first.onstart?.(new Event('start')));

    fireEvent.click(screen.getByTestId('mute'));
    expect(phaseText()).toBe('hold');
    expect(engagedText()).toBe('yes'); // still engaged: position frozen, timed driver idle
    expect(first.abortCalls).toBe(1);

    fireEvent.click(screen.getByTestId('mute')); // unmute
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(FakeRecognition.instances[1].startCalls).toBe(1);
    expect(phaseText()).toBe('starting');
  });

  it('pause holds and aborts; resume restarts', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const first = FakeRecognition.instances[0];
    act(() => first.onstart?.(new Event('start')));

    fireEvent.click(screen.getByTestId('pause'));
    expect(phaseText()).toBe('hold');
    expect(first.abortCalls).toBe(1);

    fireEvent.click(screen.getByTestId('pause')); // resume
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(phaseText()).toBe('starting');
  });

  it('transcripts while muted are ignored (no state churn, stays in hold)', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];
    act(() => rec.onstart?.(new Event('start')));
    fireEvent.click(screen.getByTestId('mute'));

    act(() => rec.onresult?.(resultEvent('hello world', true)));
    expect(phaseText()).toBe('hold');
  });

  it('fatal error (not-allowed) → blocked, recognition stopped, still engaged', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];
    act(() => rec.onstart?.(new Event('start')));

    act(() => rec.onerror?.({ name: 'not-allowed' }));
    expect(phaseText()).toBe('blocked');
    expect(engagedText()).toBe('yes');
    expect(rec.abortCalls).toBe(1);

    // The blocked-state canvas affordance flips the toggle off…
    fireEvent.click(screen.getByTestId('enable'));
    expect(phaseText()).toBe('off');
    expect(engagedText()).toBe('no');
    // …and the driver can start cleanly on the next enable.
    fireEvent.click(screen.getByTestId('enable'));
    expect(phaseText()).toBe('starting');
  });

  it('disable stops recognition and disengages the timed driver', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];
    act(() => rec.onstart?.(new Event('start')));

    fireEvent.click(screen.getByTestId('enable'));
    expect(phaseText()).toBe('off');
    expect(engagedText()).toBe('no');
    expect(rec.abortCalls).toBe(1);
  });

  it('restarts after routine recognition end using the backoff schedule', () => {
    vi.useFakeTimers();
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];
    act(() => rec.onstart?.(new Event('start')));

    act(() => rec.onend?.(new Event('end')));
    expect(phaseText()).toBe('recovering');

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(FakeRecognition.instances).toHaveLength(1); // not yet

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(FakeRecognition.instances[1].startCalls).toBe(1);
  });

  it('scheduled restarts are cancelled when the user disables mid-backoff', () => {
    vi.useFakeTimers();
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];
    act(() => rec.onstart?.(new Event('start')));
    act(() => rec.onend?.(new Event('end')));
    expect(phaseText()).toBe('recovering');

    fireEvent.click(screen.getByTestId('enable')); // disable during backoff
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(phaseText()).toBe('off');
  });

  it('reset resyncs without disturbing the listening phase (new take)', () => {
    render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];
    act(() => {
      rec.onstart?.(new Event('start'));
      rec.onresult?.(resultEvent('hello world', true));
    });

    fireEvent.click(screen.getByTestId('reset'));
    expect(phaseText()).toBe('listening');
    expect(engagedText()).toBe('yes');
    expect(FakeRecognition.instances).toHaveLength(1); // no restart on reset
  });

  it('unmount releases recognition (abort) and pending timers', () => {
    const view = render(<TestProbe />);
    fireEvent.click(screen.getByTestId('enable'));
    const rec = FakeRecognition.instances[0];
    act(() => rec.onstart?.(new Event('start')));

    view.unmount();
    expect(rec.abortCalls).toBe(1);
  });
});
