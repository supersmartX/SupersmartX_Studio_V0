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
  it.each(CASES)('review container carries the %s shape class', (ratio) => {
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
    // The review box is the element carrying an aspect-* class.
    const boxes = Array.from(container.querySelectorAll('[class*="aspect-"]'));
    expect(boxes.length).toBeGreaterThan(0);
    const expected = ASPECT_RATIO_PRESETS[ratio].cssClass;
    expect(boxes.some((el) => (el.getAttribute('class') || '').split(' ').includes(expected))).toBe(true);
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
