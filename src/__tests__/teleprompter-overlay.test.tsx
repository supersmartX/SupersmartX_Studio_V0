import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeleprompterOverlay } from '@/components/studio/TeleprompterOverlay';
import { DEFAULT_SETTINGS, TELEPROMPTER_SAFE_TOP_PX } from '@/constants';
import type { TeleprompterSettings } from '@/types';

function settings(overrides: Partial<TeleprompterSettings> = {}): TeleprompterSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/**
 * The first script line must land on the focal guideway. The guideway uses a
 * percentage of the CANVAS height; the old implementation used percentage
 * padding-top, which CSS resolves against WIDTH. These tests pin the
 * height-based spacer that keeps the two aligned.
 */
describe('TeleprompterOverlay', () => {
  it('positions the first line on the guideway at the default 15% / 80% area', () => {
    render(<TeleprompterOverlay script="Read this" settings={settings()} />);

    // 15% of the canvas is 15/80 of the 80%-tall reading surface, lifted to
    // the top-control safe area when the preview is too short.
    expect(screen.getByTestId('teleprompter-start-spacer').style.height).toBe(
      `max(18.75%, ${TELEPROMPTER_SAFE_TOP_PX}px)`,
    );
    // jsdom's CSS parser mangles the nested max()/calc(), so assert the real
    // constituents rather than an exact serialized string.
    const end = screen.getByTestId('teleprompter-end-spacer').style.height;
    expect(end).toContain('calc(100%');
    expect(end).toContain('18.75%');
    expect(end).toContain(`${TELEPROMPTER_SAFE_TOP_PX}px`);
  });

  it('recalculates the start spacer when the reading area changes', () => {
    render(
      <TeleprompterOverlay
        script="Read this"
        settings={settings({ areaHeight: 50, textStartPosition: 25 })}
      />,
    );

    expect(screen.getByTestId('teleprompter-start-spacer').style.height).toBe(
      `max(50%, ${TELEPROMPTER_SAFE_TOP_PX}px)`,
    );
  });

  it('keeps the chosen font size as a desktop cap while scaling down on phones', () => {
    render(
      <TeleprompterOverlay script="Read this" settings={settings({ fontSize: 32 })} />,
    );

    const text = screen.getByTestId('teleprompter-text');
    // Height is part of the cap: a landscape phone preview is ~250px tall, so
    // a width-only clamp left a single visible line.
    expect(text.style.fontSize).toContain('clamp(20px, min(4.2vw, 5vh), 32px)');
    expect(text.style.textShadow).toContain('rgba(0, 0, 0, 0.9)');
  });

  it('honors the configured reading width', () => {
    render(
      <TeleprompterOverlay
        script="Read this"
        settings={settings({ areaWidth: 640 })}
        containerMaxWidth={500}
      />,
    );

    expect(screen.getByTestId('teleprompter-text')).toHaveStyle({ maxWidth: '452px' });
  });
});
