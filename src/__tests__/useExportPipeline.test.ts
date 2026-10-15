import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExportPipeline } from '@/hooks/useExportPipeline';
import type { PlatformId } from '@/types';

beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:http://localhost/${Math.random().toString(36).slice(2)}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('fetch', vi.fn());
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

  it('clamps resolution when maxResolution is provided', () => {
    const { result } = renderHook(() => useExportPipeline());

    const config = result.current.selectPlatform('youtube-landscape', 3840, 2160, { width: 1920, height: 1080 });

    expect(config.outputWidth).toBeLessThanOrEqual(1920);
    expect(config.outputHeight).toBeLessThanOrEqual(1080);
  });

  it('does not clamp when within limits', () => {
    const { result } = renderHook(() => useExportPipeline());

    const config = result.current.selectPlatform('youtube-landscape', 1920, 1080, { width: 3840, height: 2160 });

    expect(config.outputWidth).toBe(1920);
    expect(config.outputHeight).toBe(1080);
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

describe('startExport', () => {
  it('throws when no exportConfig is set', async () => {
    const { result } = renderHook(() => useExportPipeline());

    const master = {
      id: 'test',
      blob: new Blob([], { type: 'video/webm' }),
      url: 'blob:http://localhost/test',
      mimeType: 'video/webm',
      extension: 'webm',
      duration: 10,
      hasAudio: false,
      sourceWidth: 1920,
      sourceHeight: 1080,
      createdAt: new Date().toISOString(),
    };

    await expect(result.current.startExport(master)).rejects.toThrow('No export config');
  });
});
