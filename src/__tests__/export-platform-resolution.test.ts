import { describe, it, expect } from 'vitest';
import { resolveInitialExportPlatform } from '@/lib/export/export-config';
import { isPlatformLockedForUser } from '@/lib/entitlements';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

// Mirrors how ExportModal builds its predicate: guests are locked out of every
// non-default format regardless of plan string, and authenticated users follow
// their entitlements.
const forFreeUser = (id: PlatformId) => isPlatformLockedForUser(id, 'free');
const forGuest = (_id: PlatformId) => true;

describe('resolveInitialExportPlatform', () => {
  it('honours an entitled retained preview choice', () => {
    expect(resolveInitialExportPlatform('instagram-reels', forFreeUser)).toBe('youtube-landscape');
    expect(resolveInitialExportPlatform('instagram-reels', () => false)).toBe('instagram-reels');
    expect(resolveInitialExportPlatform('youtube-shorts', () => false)).toBe('youtube-shorts');
  });

  it('falls back to the free default when nothing is retained', () => {
    expect(resolveInitialExportPlatform(undefined, forFreeUser)).toBe('youtube-landscape');
    expect(resolveInitialExportPlatform(undefined, () => false)).toBe('youtube-landscape');
  });

  it('downgrades a locked request so a stale config can never reach the encoder', () => {
    // Free user whose preview state still points at a Creator format
    // (e.g. carried over from a previous session or the upgrade flow).
    expect(resolveInitialExportPlatform('youtube-shorts', forFreeUser)).toBe('youtube-landscape');
    expect(resolveInitialExportPlatform('linkedin', forFreeUser)).toBe('youtube-landscape');
  });

  it('applies the same lock rule to guests — the gate must not switch off when unauthenticated', () => {
    for (const preset of LAUNCH_PLATFORM_PRESETS) {
      expect(resolveInitialExportPlatform(preset.id, forGuest)).toBe('youtube-landscape');
    }
  });

  it('never resolves to a platform outside the launch matrix', () => {
    const launchIds = LAUNCH_PLATFORM_PRESETS.map((p) => p.id);
    for (const candidate of [undefined, 'custom', 'not-a-platform'] as (PlatformId | undefined)[]) {
      const resolved = resolveInitialExportPlatform(candidate, () => false);
      expect(launchIds).toContain(resolved);
    }
  });
});
