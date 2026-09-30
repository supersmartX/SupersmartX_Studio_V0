import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@/components/layout/Canvas';
import { ASPECT_RATIO_PRESETS } from '@/constants';
import type { AspectRatio } from '@/types';

const CASES: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

// The review box shape is the visible half of "Preview as": it must track
// the selected platform's aspect via the shared preset classes.
describe('Canvas review box shape per platform', () => {
  beforeEach(() => {
    // jsdom has no media playback; resolve play() so effects settle.
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      (() => Promise.resolve()) as () => Promise<void>,
    );
  });
  it.each(CASES)('review box is exactly the %s frame', (ratio) => {
    const { container } = render(
      <Canvas
        focusViewEnabled={false}
        onFocusViewToggle={() => {}}
        aspectRatio="16:9"
        recordingConfig={{ width: 1920, height: 1080 } as never}
        reviewVideoUrl="blob:review"
        reviewAspectRatio={ratio}
      >
        <div />
      </Canvas>,
    );
    // Assert the box's EFFECTIVE shape, not a Tailwind class name.
    //
    // This used to assert the element carried ASPECT_RATIO_PRESETS[ratio]
    // .cssClass (e.g. "aspect-video"). That proved a class was present and
    // nothing about the rendered ratio — and the class was in fact inert on
    // desktop, where `w-full` + `sm:h-full` make `aspect-ratio` yield to two
    // definite axes. A 16:9 review box then measured 6.36:1 at 1600x900 and
    // 11.25:1 at 1440x620, so the preview showed a completely different crop
    // from the exported file. The shape now comes from getPreviewBoxStyle.
    const expected = ASPECT_RATIO_PRESETS[ratio];
    const box = Array.from(container.querySelectorAll<HTMLElement>('div')).find((el) => {
      const s = el.style;
      return s.aspectRatio !== '' || s.width !== '';
    });
    expect(box, `no shaped box found for ${ratio}`).toBeDefined();
    expect(box!.style.aspectRatio).toBe(`${expected.width} / ${expected.height}`);
    // Sized by the binding axis, so no max-w/max-h can clamp the ratio away.
    // The CSS engine folds `calc(100cqh * w / h)` down to `<k>cqh`, where
    // k = 100 * w / h — assert the coefficient, not the literal text.
    expect(box!.style.width).toMatch(/^min\(100cqw,\s*([\d.]+)cqh\)$/);
    const coefficient = Number(box!.style.width.match(/([\d.]+)cqh/)![1]);
    expect(coefficient).toBeCloseTo((100 * expected.width) / expected.height, 6);
    expect(box!.style.maxWidth).toBe('');
    expect(box!.style.maxHeight).toBe('');
  });

  it('the box wrapper is a size container so cqw/cqh resolve', () => {
    const { container } = render(
      <Canvas
        focusViewEnabled={false}
        onFocusViewToggle={() => {}}
        aspectRatio="16:9"
        recordingConfig={{ width: 1920, height: 1080 } as never}
        reviewVideoUrl="blob:review"
        reviewAspectRatio="9:16"
      >
        <div />
      </Canvas>,
    );
    // Without container-type:size the min() has no cqw/cqh to resolve against
    // and the width declaration is dropped, collapsing the box.
    const wrapper = container.querySelector<HTMLElement>('div');
    expect(wrapper!.style.containerType || wrapper!.getAttribute('style')).toBeTruthy();
    expect(getComputedStyle(wrapper!).containerType).toBe('size');
  });

  it('uses distinct shapes per ratio family', () => {
    expect(ASPECT_RATIO_PRESETS['16:9'].cssClass).not.toBe(ASPECT_RATIO_PRESETS['9:16'].cssClass);
    expect(ASPECT_RATIO_PRESETS['9:16'].cssClass).not.toBe(ASPECT_RATIO_PRESETS['1:1'].cssClass);
    expect(ASPECT_RATIO_PRESETS['1:1'].cssClass).not.toBe(ASPECT_RATIO_PRESETS['4:5'].cssClass);
  });

  it('applies the shared-geometry crop style to the review video', () => {
    const { container } = render(
      <Canvas
        focusViewEnabled={false}
        onFocusViewToggle={() => {}}
        aspectRatio="16:9"
        recordingConfig={{ width: 1920, height: 1080 } as never}
        reviewVideoUrl="blob:review"
        reviewAspectRatio="9:16"
        reviewVideoStyle={{ objectFit: 'cover', objectPosition: '50% 50%' }}
      >
        <div />
      </Canvas>,
    );
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.style.objectFit).toBe('cover');
    expect(video!.style.objectPosition).toBe('50% 50%');
  });
});
