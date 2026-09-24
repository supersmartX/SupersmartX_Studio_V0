import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatDate,
  formatFileSize,
  formatQualityLabel,
  formatRecordingFormat,
  exportStatusLabel,
  platformDisplayName,
} from '@/utils/format';

describe('user-facing metadata formatting (no jargon)', () => {
  it('formats calendar dates like "Sep 24, 2026"', () => {
    expect(formatDate('2026-09-24T10:00:00.000Z')).toBe('Sep 24, 2026');
    expect(formatDate('not-a-date')).toBe('Unknown date');
  });

  it('formats file sizes without raw byte counts', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(18.4 * 1024 * 1024)).toBe('18.4 MB');
    expect(formatFileSize(8.2 * 1024 * 1024)).toBe('8.2 MB');
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
    expect(formatFileSize(NaN)).toBe('Unknown size');
  });

  it('labels quality in human words', () => {
    expect(formatQualityLabel(1080)).toBe('Full HD');
    expect(formatQualityLabel(1920)).toBe('Full HD');
    expect(formatQualityLabel(720)).toBe('HD');
    expect(formatQualityLabel(480)).toBe('SD');
    expect(formatQualityLabel(0)).toBe('');
  });

  it('never exposes raw MIME strings', () => {
    expect(formatRecordingFormat('video/webm;codecs=vp9,opus', 'webm')).toBe('WebM video');
    expect(formatRecordingFormat('video/mp4', 'mp4')).toBe('MP4 video');
    expect(formatRecordingFormat('', '')).toBe('Video');
    const out = formatRecordingFormat('video/webm;codecs=vp9,opus', 'webm');
    expect(out).not.toContain('codecs');
    expect(out).not.toContain(';');
  });

  it('maps export states to user words', () => {
    expect(exportStatusLabel('completed')).toBe('Ready');
    expect(exportStatusLabel('failed')).toBe('Failed');
    expect(exportStatusLabel('encoding')).toBe('Preparing…');
    expect(exportStatusLabel('bogus')).toBe('Ready');
  });

  it('names platforms from the single preset source', () => {
    expect(platformDisplayName('youtube-landscape')).toBe('YouTube');
    expect(platformDisplayName('instagram-post')).toBe('Instagram Square');
    expect(platformDisplayName('mystery')).toBe('mystery');
  });

  it('keeps the spec card example consistent', () => {
    // "00:42 · 1920 × 1080 · 18.4 MB" + "Recorded Sep 24, 2026"
    const line = `${formatTime(42)} · ${1920} × ${1080} · ${formatFileSize(18.4 * 1024 * 1024)}`;
    expect(line).toBe('00:42 · 1920 × 1080 · 18.4 MB');
    expect(`Recorded ${formatDate('2026-09-24T10:00:00.000Z')}`).toBe('Recorded Sep 24, 2026');
  });
});
