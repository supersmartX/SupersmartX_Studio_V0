import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExportPipeline } from '@/hooks/useExportPipeline';
import type { PlatformId } from '@/types';

beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
    revokeObjectURL: vi.fn(),
  });
});

describe('selectPlatform', () => {
  it('returns correct config for YouTube Landscape', () => {
    const { result } = renderHook(() => useExportPipeline());

    const config = result.current.selectPlatform('youtube-landscape', 1920, 1080);

    expect(config.platformId).toBe('youtube-landscape');
    expect(config.outputWidth).toBe(1920);
    expect(config.outputHeight).toBe(1080);
    expect(config.aspectRatio).toBe('16:9');
  });

  it('returns correct config for YouTube Shorts (9:16)', () => {
    const { result } = renderHook(() => useExportPipeline());

    const config = result.current.selectPlatform('youtube-shorts', 1920, 1080);

    expect(config.platformId).toBe('youtube-shorts');
    expect(config.outputWidth).toBe(1080);
    expect(config.outputHeight).toBe(1920);
    expect(config.aspectRatio).toBe('9:16');
  });

  it('returns correct config for Instagram Post (1:1)', () => {
    const { result } = renderHook(() => useExportPipeline());

    const config = result.current.selectPlatform('instagram-post', 1920, 1080);

    expect(config.outputWidth).toBe(1080);
    expect(config.outputHeight).toBe(1080);
  });

  it('returns correct config for Instagram Portrait (4:5)', () => {
    const { result } = renderHook(() => useExportPipeline());

    const config = result.current.selectPlatform('instagram-portrait', 1920, 1080);

    expect(config.outputWidth).toBe(1080);
    expect(config.outputHeight).toBe(1350);
    expect(config.aspectRatio).toBe('4:5');
  });

  it('returns fallback config for unknown platform', () => {
    const { result } = renderHook(() => useExportPipeline());

    const config = result.current.selectPlatform('nonexistent' as PlatformId, 1920, 1080);

    expect(config.platformId).toBe('custom');
    expect(config.outputWidth).toBe(1920);
    expect(config.outputHeight).toBe(1080);
  });

  it('sets exportConfig state', () => {
    const { result } = renderHook(() => useExportPipeline());

    act(() => {
      result.current.selectPlatform('tiktok', 1920, 1080);
    });

    expect(result.current.exportConfig).not.toBeNull();
    expect(result.current.exportConfig?.platformId).toBe('tiktok');
  });
});

describe('updateCrop', () => {
  it('updates crop x coordinate', () => {
    const { result } = renderHook(() => useExportPipeline());

    act(() => {
      result.current.selectPlatform('youtube-landscape', 1920, 1080);
    });

    act(() => {
      result.current.updateCrop({ x: 100 });
    });

    expect(result.current.exportConfig?.crop.x).toBe(100);
  });

  it('updates crop zoom', () => {
    const { result } = renderHook(() => useExportPipeline());

    act(() => {
      result.current.selectPlatform('youtube-landscape', 1920, 1080);
    });

    act(() => {
      result.current.updateCrop({ zoom: 1.5 });
    });

    expect(result.current.exportConfig?.crop.zoom).toBe(1.5);
  });

  it('no-ops when no exportConfig exists', () => {
    const { result } = renderHook(() => useExportPipeline());

    act(() => {
      result.current.updateCrop({ x: 100 });
    });

    expect(result.current.exportConfig).toBeNull();
  });
});

describe('resetCrop', () => {
  it('resets crop to default centered position', () => {
    const { result } = renderHook(() => useExportPipeline());

    act(() => {
      result.current.selectPlatform('youtube-landscape', 1920, 1080);
    });

    act(() => {
      result.current.updateCrop({ x: 500, y: 300, zoom: 2 });
    });

    act(() => {
      result.current.resetCrop();
    });

    expect(result.current.exportConfig?.crop.zoom).toBe(1);
    expect(result.current.exportConfig?.crop.x).toBeGreaterThanOrEqual(0);
    expect(result.current.exportConfig?.crop.y).toBeGreaterThanOrEqual(0);
  });
});

describe('cancelExport', () => {
  it('removes job from exportJobs', () => {
    const { result } = renderHook(() => useExportPipeline());

    act(() => {
      result.current.cancelExport('nonexistent-id');
    });

    expect(result.current.exportJobs).toHaveLength(0);
  });
});

describe('clearJobs', () => {
  it('clears all export jobs', () => {
    const { result } = renderHook(() => useExportPipeline());

    act(() => {
      result.current.clearJobs();
    });

    expect(result.current.exportJobs).toHaveLength(0);
  });
});
