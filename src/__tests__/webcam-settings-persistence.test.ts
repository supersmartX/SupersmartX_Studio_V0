import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettings } from '@/hooks/useSettings';
import { DEFAULT_WEBCAM_OVERLAY, WEBCAM_SCALE_MAX } from '@/lib/recording/webcam-overlay';

/**
 * Screen+webcam composition settings persist with the rest of the studio
 * settings and survive a reload with sanitized values (normalized coordinates
 * keep the layout correct at any canvas size).
 */
describe('useSettings webcam overlay persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to a centered, visible, mirrored rounded overlay', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.webcamOverlay).toEqual(DEFAULT_WEBCAM_OVERLAY);
  });

  it('persists overlay changes to localStorage', async () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.setWebcamOverlay({ x: 0.9, y: 0.1, shape: 'circle' });
    });
    // Debounced save (500ms).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    const raw = localStorage.getItem('sxs-studio-settings');
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!) as { webcamOverlay?: { x: number; y: number; shape: string } };
    expect(saved.webcamOverlay?.x).toBeCloseTo(0.9, 6);
    expect(saved.webcamOverlay?.y).toBeCloseTo(0.1, 6);
    expect(saved.webcamOverlay?.shape).toBe('circle');
  });

  it('restores and sanitizes a persisted overlay on mount', async () => {
    localStorage.setItem(
      'sxs-studio-settings',
      JSON.stringify({
        webcamOverlay: { visible: true, x: 0.7, y: 0.3, scale: 99, shape: 'circle', mirrored: false, deviceId: 'cam-9' },
      }),
    );
    const { result } = renderHook(() => useSettings());
    expect(result.current.webcamOverlay.scale).toBe(WEBCAM_SCALE_MAX);
    expect(result.current.webcamOverlay.x).toBeCloseTo(0.7, 6);
    expect(result.current.webcamOverlay.mirrored).toBe(false);
    expect(result.current.webcamOverlay.deviceId).toBe('cam-9');
  });

  it('ignores a corrupt overlay payload without breaking other settings', async () => {
    localStorage.setItem('sxs-studio-settings', '{not json');
    const { result } = renderHook(() => useSettings());
    expect(result.current.webcamOverlay).toEqual(DEFAULT_WEBCAM_OVERLAY);
    expect(result.current.countdownEnabled).toBe(true);
  });
});
