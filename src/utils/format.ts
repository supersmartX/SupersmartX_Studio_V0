export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// User-facing calendar date, e.g. "Sep 24, 2026". Returns 'Unknown date'
// for unparseable input rather than "Invalid Date".
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// User-facing file size, e.g. "18.4 MB". Never exposes raw byte counts.
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// User-facing quality label from output height, e.g. "Full HD".
export function formatQualityLabel(height: number): string {
  if (!Number.isFinite(height) || height <= 0) return '';
  if (height >= 1080) return 'Full HD';
  if (height >= 720) return 'HD';
  return 'SD';
}

import { PLATFORM_PRESETS } from '@/constants';

// User-facing platform name with raw-id fallback. Keeps preview, export,
// and library on the single PLATFORM_PRESETS source of truth.
export function platformDisplayName(platformId: string): string {
  return PLATFORM_PRESETS.find((p) => p.id === platformId)?.label ?? platformId;
}

// User-facing container label. Never expose raw MIME strings
// (e.g. "video/webm;codecs=vp9,opus") in the UI.
export function formatRecordingFormat(mimeType: string, extension: string): string {
  const ext = (extension || '').toLowerCase();
  if (ext === 'mp4' || (mimeType || '').includes('mp4')) return 'MP4 video';
  if (ext === 'webm' || (mimeType || '').includes('webm')) return 'WebM video';
  return ext ? `${ext.toUpperCase()} video` : 'Video';
}

// User-facing status words for export rows. Never expose internal
// job-machine states.
export function exportStatusLabel(status: string): string {
  if (status === 'completed') return 'Ready';
  if (status === 'failed') return 'Failed';
  if (status === 'pending' || status === 'encoding' || status === 'uploading') return 'Preparing…';
  return 'Ready';
}

export function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (isNaN(timestamp)) return 'unknown';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
