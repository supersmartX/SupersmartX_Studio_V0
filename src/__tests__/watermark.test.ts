import { describe, it, expect, vi } from 'vitest';
import { getEntitlements } from '@/lib/entitlements';
import { drawWatermark } from '@/hooks/useExportPipeline';

describe('watermark entitlement', () => {
  it('free requires watermark', () => expect(getEntitlements('free').watermarkRequired).toBe(true));
  it('creator does not require watermark', () => expect(getEntitlements('creator_monthly').watermarkRequired).toBe(false));
  it('creator yearly does not require watermark', () => expect(getEntitlements('creator_yearly').watermarkRequired).toBe(false));
  it('pro still requires watermark false', () => expect(getEntitlements('pro_monthly').watermarkRequired).toBe(false));
});

describe('drawWatermark', () => {
  it('draws visible watermark on canvas', () => {
    const fillRect = vi.fn();
    const fillText = vi.fn();
    const measureText = vi.fn(() => ({ width: 100 } as any));
    const save = vi.fn();
    const restore = vi.fn();
    const ctx = {
      save, restore, fillRect, fillText, measureText,
      globalAlpha: 1, fillStyle: '', font: '', textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D;
    drawWatermark(ctx, 1920, 1080);
    expect(fillText).toHaveBeenCalledWith('SupersmartX', expect.any(Number), expect.any(Number));
    expect(fillRect).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(restore).toHaveBeenCalled();
  });
  it('draws watermark with correct text', () => {
    const ctx = {
      save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 80 } as any)),
      globalAlpha: 1, fillStyle: '', font: '', textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D;
    drawWatermark(ctx, 1080, 1920);
    expect(ctx.fillText).toHaveBeenCalledWith('SupersmartX', expect.any(Number), expect.any(Number));
  });
});
