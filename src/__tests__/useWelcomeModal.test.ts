import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWelcomeModal } from '@/hooks/useWelcomeModal';

/* Onboarding used to reappear on EVERY full page load, because the dismissal
 * was only written when "Don't show again" was ticked
 * (src/hooks/useWelcomeModal.ts). On the upgrade journey that meant it stacked
 * on top of "You're a Creator" after the Cashfree return and swallowed the
 * "Continue creating" click — the user's route back to the take they just paid
 * to export. sessionStorage is the right scope: it survives the
 * cross-document navigation that payment performs in this same tab, and a new
 * tab is a new visitor. */
describe('welcome modal dismissal survives the payment return', () => {
  let local: Record<string, string>;
  let session: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    local = {};
    session = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => local[k] ?? null,
      setItem: (k: string, v: string) => { local[k] = v; },
      removeItem: (k: string) => { delete local[k]; },
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => session[k] ?? null,
      setItem: (k: string, v: string) => { session[k] = v; },
      removeItem: (k: string) => { delete session[k]; },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not come back in the same tab after a plain dismissal', () => {
    const first = renderHook(() => useWelcomeModal());
    act(() => { vi.advanceTimersByTime(600); });
    expect(first.result.current.isVisible).toBe(true);

    act(() => first.result.current.closeModal());
    expect(first.result.current.isVisible).toBe(false);
    // "Don't show again" was never ticked.
    expect(local['sxs-studio-hide-welcome']).toBeUndefined();

    first.unmount();

    // The return trip: a brand new document, same tab.
    const afterReturn = renderHook(() => useWelcomeModal());
    act(() => { vi.advanceTimersByTime(600); });
    expect(afterReturn.result.current.isVisible).toBe(false);
  });

  it('still honours "Don\'t show again" across tabs', () => {
    const first = renderHook(() => useWelcomeModal());
    act(() => { vi.advanceTimersByTime(600); });
    act(() => first.result.current.setDontShowAgain(true));
    act(() => first.result.current.closeModal());
    expect(local['sxs-studio-hide-welcome']).toBe('true');
    first.unmount();

    // A new tab: sessionStorage is per-tab, so only the permanent flag holds.
    session = {};
    const newTab = renderHook(() => useWelcomeModal());
    act(() => { vi.advanceTimersByTime(600); });
    expect(newTab.result.current.isVisible).toBe(false);
  });

  it('shows onboarding again for a brand new tab', () => {
    const first = renderHook(() => useWelcomeModal());
    act(() => { vi.advanceTimersByTime(600); });
    act(() => first.result.current.closeModal());
    first.unmount();

    // A new tab, no permanent suppression: this is a first-time visitor.
    session = {};
    const newTab = renderHook(() => useWelcomeModal());
    act(() => { vi.advanceTimersByTime(600); });
    expect(newTab.result.current.isVisible).toBe(true);
  });

  it('a permanent suppression skips the timer entirely', () => {
    local['sxs-studio-hide-welcome'] = 'true';
    const { result } = renderHook(() => useWelcomeModal());
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.isVisible).toBe(false);
  });
});
