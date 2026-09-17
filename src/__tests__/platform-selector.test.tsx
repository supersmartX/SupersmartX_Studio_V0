import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlatformSelector } from '@/components/studio/PlatformSelector';
import { PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

interface Overrides {
  selectedPlatformId?: PlatformId;
  isAuthenticated?: boolean;
  userPlan?: string;
}

function renderSelector(overrides: Overrides = {}) {
  const props = {
    onSelect: vi.fn(),
    onUpgradeRequired: vi.fn(),
    selectedPlatformId: 'youtube-landscape' as PlatformId,
    isAuthenticated: true,
    userPlan: 'free',
    ...overrides,
  };
  render(<PlatformSelector {...props} />);
  return props;
}

const TOTAL_PRESETS = PLATFORM_PRESETS.length;

describe('PlatformSelector — Creator-only platform availability', () => {
  describe('Free plan (authenticated)', () => {
    it('keeps YouTube 16:9 unlocked and selectable while every other format is locked', () => {
      renderSelector({ userPlan: 'free' });

      const youtube = screen.getByRole('radio', { name: 'YouTube' });
      expect(youtube).not.toHaveAttribute('aria-disabled', 'true');
      expect(youtube).toHaveAttribute('aria-checked', 'true');

      // Locked platforms show lock icon (SVG) + "Creator plan" sublabel, no "👑 CREATOR" text badge
      const lockedButtons = screen.getAllByRole('radio').filter(
        (el) => el.getAttribute('aria-disabled') === 'true'
      );
      expect(lockedButtons).toHaveLength(TOTAL_PRESETS - 1);

      const shorts = screen.getByRole('radio', { name: 'YouTube Shorts, Creator plan required' });
      expect(shorts).toHaveAttribute('aria-disabled', 'true');
      expect(shorts).toHaveAttribute('aria-checked', 'false');
    });

    it('shows "Creator plan" sublabel for locked formats', () => {
      renderSelector({ userPlan: 'free' });

      // Locked platforms show "Creator plan" as sublabel
      const creatorPlanLabels = screen.getAllByText('Creator plan');
      expect(creatorPlanLabels.length).toBeGreaterThanOrEqual(1);
    });

    it('selecting the free platform calls onSelect only', () => {
      const { onSelect, onUpgradeRequired } = renderSelector({ userPlan: 'free' });

      fireEvent.click(screen.getByRole('radio', { name: 'YouTube' }));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('youtube-landscape');
      expect(onUpgradeRequired).not.toHaveBeenCalled();
    });

    it('never switches to a locked platform — opens upgrade flow instead', () => {
      const { onSelect, onUpgradeRequired } = renderSelector({ userPlan: 'free' });

      fireEvent.click(screen.getByRole('radio', { name: 'TikTok, Creator plan required' }));

      expect(onSelect).not.toHaveBeenCalled();
      expect(onUpgradeRequired).toHaveBeenCalledTimes(1);
    });

    it('treats Custom as Creator-locked for Free users', () => {
      const { onSelect, onUpgradeRequired } = renderSelector({ userPlan: 'free' });

      const custom = screen.getByRole('radio', { name: 'Custom, Creator plan required' });
      expect(custom).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(custom);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onUpgradeRequired).toHaveBeenCalledTimes(1);
    });
  });

  describe('Creator plan', () => {
    it('unlocks every platform with no lock badges or upgrade flow', () => {
      const { onSelect, onUpgradeRequired } = renderSelector({ userPlan: 'creator_monthly' });

      // No lock icons (SVG) present — all radios are unlocked
      const lockedButtons = screen.getAllByRole('radio').filter(
        (el) => el.getAttribute('aria-disabled') === 'true'
      );
      expect(lockedButtons).toHaveLength(0);
      expect(screen.getAllByRole('radio')).toHaveLength(TOTAL_PRESETS);

      const shorts = screen.getByRole('radio', { name: 'YouTube Shorts' });
      expect(shorts).not.toHaveAttribute('aria-disabled', 'true');

      fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));

      expect(onSelect).toHaveBeenCalledWith('tiktok');
      expect(onUpgradeRequired).not.toHaveBeenCalled();
    });

    it('treats the internal Pro plan as Creator (all unlocked)', () => {
      renderSelector({ userPlan: 'pro_monthly' });

      const lockedButtons = screen.getAllByRole('radio').filter(
        (el) => el.getAttribute('aria-disabled') === 'true'
      );
      expect(lockedButtons).toHaveLength(0);
      const reals = screen.getByRole('radio', { name: 'Reels' });
      expect(reals).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('Guests (not signed in)', () => {
    it('shows no lock state and allows any platform selection (mirrors export flow)', () => {
      const { onSelect, onUpgradeRequired } = renderSelector({ isAuthenticated: false });

      const lockedButtons = screen.getAllByRole('radio').filter(
        (el) => el.getAttribute('aria-disabled') === 'true'
      );
      expect(lockedButtons).toHaveLength(0);
      expect(screen.getAllByRole('radio')).toHaveLength(TOTAL_PRESETS);

      fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));

      expect(onSelect).toHaveBeenCalledWith('tiktok');
      expect(onUpgradeRequired).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('gives locked platforms a meaningful accessible name instead of relying on the badge', () => {
      renderSelector({ userPlan: 'free' });

      const locked = screen.getByRole('radio', { name: 'YouTube Shorts, Creator plan required' });
      expect(locked).toHaveAttribute('aria-disabled', 'true');
      // Lock icon SVG is present (no title attribute needed — aria-label provides the context)
      expect(locked.querySelector('svg')).not.toBeNull();
    });
  });
});
