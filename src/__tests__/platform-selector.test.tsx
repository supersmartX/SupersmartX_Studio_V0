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

      const youtube = screen.getByRole('radio', { name: /YouTube Landscape · 16:9/ });
      expect(youtube).not.toHaveAttribute('aria-disabled', 'true');
      expect(youtube).toHaveAttribute('aria-checked', 'true');

      expect(screen.getAllByText('👑 CREATOR')).toHaveLength(TOTAL_PRESETS - 1);

      const shorts = screen.getByRole('radio', { name: 'YouTube Shorts, Creator plan required' });
      expect(shorts).toHaveAttribute('aria-disabled', 'true');
      expect(shorts).toHaveAttribute('aria-checked', 'false');
    });

    it('shows Creator in the sublabel for locked formats', () => {
      renderSelector({ userPlan: 'free' });

      expect(screen.getAllByText('Vertical · 9:16 · Creator').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Square · 1:1 · Creator'));
      expect(screen.getByText('Portrait · 4:5 · Creator'));
      expect(screen.getByText('Define your own · Creator'));
    });

    it('selecting the free platform calls onSelect only', () => {
      const { onSelect, onUpgradeRequired } = renderSelector({ userPlan: 'free' });

      fireEvent.click(screen.getByRole('radio', { name: /YouTube Landscape · 16:9/ }));

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

      expect(screen.queryByText('👑 CREATOR')).toBeNull();
      expect(screen.getAllByRole('radio')).toHaveLength(TOTAL_PRESETS);
      expect(screen.getByRole('radio', { name: /YouTube Shorts Vertical · 9:16/ })).not.toHaveAttribute('aria-disabled', 'true');

      fireEvent.click(screen.getByRole('radio', { name: /TikTok Vertical · 9:16/ }));

      expect(onSelect).toHaveBeenCalledWith('tiktok');
      expect(onUpgradeRequired).not.toHaveBeenCalled();
    });

    it('treats the internal Pro plan as Creator (all unlocked)', () => {
      renderSelector({ userPlan: 'pro_monthly' });

      expect(screen.queryByText('👑 CREATOR')).toBeNull();
      expect(screen.getByRole('radio', { name: /Instagram Portrait · 4:5/ })).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('Guests (not signed in)', () => {
    it('shows no lock state and allows any platform selection (mirrors export flow)', () => {
      const { onSelect, onUpgradeRequired } = renderSelector({ isAuthenticated: false });

      expect(screen.queryByText('👑 CREATOR')).toBeNull();
      expect(screen.getAllByRole('radio')).toHaveLength(TOTAL_PRESETS);

      fireEvent.click(screen.getByRole('radio', { name: /TikTok Vertical · 9:16/ }));

      expect(onSelect).toHaveBeenCalledWith('tiktok');
      expect(onUpgradeRequired).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('gives locked platforms a meaningful accessible name instead of relying on the badge', () => {
      renderSelector({ userPlan: 'free' });

      const locked = screen.getByRole('radio', { name: 'YouTube Shorts, Creator plan required' });
      expect(locked).toHaveAttribute('aria-disabled', 'true');
      expect(locked.querySelector('[title="Creator plan required"]')).not.toBeNull();
    });
  });
});