import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlatformPreviewSwitcher } from '@/components/studio/PlatformPreviewSwitcher';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';

describe('PlatformPreviewSwitcher', () => {
  it('exposes exactly one selected chip to assistive tech', () => {
    render(<PlatformPreviewSwitcher selectedPlatformId="youtube-shorts" onSelect={() => {}} />);

    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(LAUNCH_PLATFORM_PRESETS.length);

    // The selected chip was previously distinguishable only by its fill colour.
    const pressed = chips.filter((chip) => chip.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toContain('YouTube Shorts');
  });

  it('selects an unlocked platform and routes a locked one to the upgrade path', () => {
    const onSelect = vi.fn();
    const onLockedClick = vi.fn();
    render(
      <PlatformPreviewSwitcher
        selectedPlatformId="youtube-landscape"
        onSelect={onSelect}
        isLocked={(id) => id === 'tiktok'}
        onLockedClick={onLockedClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /TikTok/ }));
    expect(onLockedClick).toHaveBeenCalledWith('tiktok');
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /LinkedIn/ }));
    expect(onSelect).toHaveBeenCalledWith('linkedin');
  });
});
