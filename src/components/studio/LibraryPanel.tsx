'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAllRecordings, deleteRecording, renameRecording, type StoredRecording } from '@/lib/recording-store';
import { getAllLocalExports, deleteLocalExport, type LocalExport } from '@/lib/local-exports-store';
import { formatTime, formatRelativeTime, formatDate, formatFileSize, formatQualityLabel, formatRecordingFormat, exportStatusLabel, platformDisplayName } from '@/utils/format';
import { isCreatorPlan } from '@/lib/entitlements';
import { setPendingDownload, stashPendingDownloadExportId } from '@/lib/auth-guard';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { Modal } from '@/components/ui/Modal';
import type { PlanType } from '@/types/db';
import { PlayIcon, SettingsIcon } from '@/components/icons';

interface RecordingsPanelProps {
  onExportRecording?: (recording: StoredRecording) => void;
  isMobile?: boolean;
  isAuthenticated?: boolean;
  userPlan?: PlanType | 'free';
  refreshKey?: number;
  onAuthRequired?: () => void;
}

export type DownloadOutcome =
  | { kind: 'download'; url: string }
  | { kind: 'reauth' }
  | { kind: 'error'; message: string };

const GENERIC_DOWNLOAD_ERROR = 'Download failed. Please try again.';

// Maps a /api/download response to a UI action. 401 (missing, expired, or
// revoked session) always becomes an explicit re-auth action — never silent,
// never a raw server string.
export function classifyDownloadResponse(status: number, body: { url?: unknown; error?: unknown }): DownloadOutcome {
  if (status === 200 && typeof body.url === 'string' && body.url.length > 0) {
    return { kind: 'download', url: body.url };
  }
  if (status === 401) {
    return { kind: 'reauth' };
  }
  const message = typeof body.error === 'string' && body.error.length > 0 ? body.error : GENERIC_DOWNLOAD_ERROR;
  return { kind: 'error', message };
}

function RecordingThumbnail({ recording }: { recording: StoredRecording }) {
  const [hasError, setHasError] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(recording.blob);
    setSourceUrl(url);
    setHasError(false);
    return () => {
      URL.revokeObjectURL(url);
      setSourceUrl(null);
    };
  }, [recording.blob]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-[#111217] border border-border-subtle">
      {!hasError ? (
        <video
          src={sourceUrl || undefined}
          muted
          playsInline
          preload="metadata"
          onError={() => setHasError(true)}
          className="h-full w-full object-cover"
          aria-label={`Preview thumbnail for ${recording.name || 'video recording'}`}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-text-muted" aria-label="Video thumbnail unavailable">
          <PlayIcon className="h-8 w-8 opacity-50" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
      <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {formatTime(recording.duration)}
      </span>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20">
          <PlayIcon className="h-5 w-5" />
        </span>
      </span>
    </div>
  );
}

function RecordingPreviewModal({ recording, onClose }: { recording: StoredRecording; onClose: () => void }) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(recording.blob);
    setSourceUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setSourceUrl(null);
    };
  }, [recording.blob]);

  // No forced aspect class: object-contain preserves 16:9, 9:16, 1:1, 4:5.
  return (
    <Modal isOpen onClose={onClose} title={recording.name || 'Video recording'} maxWidth="max-w-3xl" ariaLabel="Recording preview">
      <video src={sourceUrl || undefined} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-lg bg-black object-contain" />
      <p className="mt-3 text-xs text-text-secondary">
        Recorded {formatDate(recording.createdAt)} · {formatTime(recording.duration)} · {recording.width} × {recording.height} · {formatFileSize(recording.blob.size)}
      </p>
    </Modal>
  );
}

function CloudPreviewModal({ url, title, meta, onClose }: { url: string; title: string; meta: string; onClose: () => void }) {
  return (
    <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-3xl" ariaLabel="Export preview">
      <video src={url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-lg bg-black object-contain" />
      <p className="mt-3 text-xs text-text-secondary">{meta}</p>
    </Modal>
  );
}

export function RecordingsPanel({ onExportRecording, isMobile, isAuthenticated, userPlan = 'free', refreshKey, onAuthRequired }: RecordingsPanelProps) {
  // Cloud library is a Creator entitlement — Free is local-first.
  const canUseCloudLibrary = isCreatorPlan(userPlan);
  const [recordings, setRecordings] = useState<StoredRecording[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Cloud + local exports
  const [cloudExports, setCloudExports] = useState<Array<{ id: string; r2Key: string; platform: string; outputWidth: number; outputHeight: number; fileSize: number; createdAt: string; status: string }>>([]);
  const [localExports, setLocalExports] = useState<LocalExport[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewCloudMeta, setPreviewCloudMeta] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [previewRecording, setPreviewRecording] = useState<StoredRecording | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the card menu on outside click or Escape — never for critical
  // dialogs (this menu only holds safe actions: export/rename/details/delete
  // prompt, and delete itself still asks for confirmation).
  useDismissOnOutsideClick(menuRef, openMenuId !== null, () => setOpenMenuId(null));

  const loadRecordings = useCallback(async () => {
    const all = await getAllRecordings();
    setRecordings(all);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteRecording(id);
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
  }, []);

  const handleStartRename = useCallback((recording: StoredRecording, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(recording.id);
    setEditName(recording.name || `${recording.extension.toUpperCase()} Recording`);
  }, []);

  const handleSaveRename = useCallback(async (id: string) => {
    const trimmed = editName.trim();
    if (trimmed) {
      await renameRecording(id, trimmed);
      setRecordings((prev) => prev.map((r) => r.id === id ? { ...r, name: trimmed } : r));
    }
    setEditingId(null);
    setEditName('');
  }, [editName]);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setEditName('');
  }, []);

  const getDisplayName = useCallback((recording: StoredRecording) => {
    return recording.name || 'Video recording';
  }, []);

  const loadCloudExports = useCallback(async () => {
    if (!isAuthenticated) { setCloudExports([]); return; }
    setCloudLoading(true); setCloudError('');
    try {
      const res = await fetch('/api/exports');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setCloudExports(data.exports || []);
    } catch {
      setCloudError('Could not load cloud exports');
    } finally { setCloudLoading(false); }
  }, [isAuthenticated]);

  const loadLocalExports = useCallback(async () => {
    const locals = await getAllLocalExports();
    setLocalExports(locals);
  }, []);

  useEffect(() => {
    loadCloudExports();
    loadLocalExports();
  }, [loadCloudExports, loadLocalExports, refreshKey]);

  const handleDeleteCloud = useCallback(async (id: string) => {
    const res = await fetch(`/api/exports/${id}`, { method: 'DELETE' });
    if (res.ok) setCloudExports(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleDeleteLocal = useCallback(async (id: string) => {
    await deleteLocalExport(id);
    setLocalExports(prev => prev.filter(e => e.id !== id));
  }, []);

  const handlePreviewCloud = useCallback(async (id: string) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/exports/${id}/preview`);
      if (!res.ok) throw new Error('Preview failed');
      const data = await res.json();
      const exp = cloudExports.find((e) => e.id === id);
      setPreviewCloudMeta(
        exp
          ? `${platformDisplayName(exp.platform)} · ${exp.outputWidth} × ${exp.outputHeight} · ${formatFileSize(exp.fileSize)}`
          : '',
      );
      setPreviewUrl(data.url);
    } catch { setCloudError('Preview failed'); }
    finally { setPreviewLoading(false); }
  }, [cloudExports]);

  const handleDownloadCloud = useCallback(async (id: string) => {
    setCloudError('');
    try {
      const res = await fetch(`/api/download?exportId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      const outcome = classifyDownloadResponse(res.status, data);
      if (outcome.kind === 'download') {
        const a = document.createElement('a');
        a.href = outcome.url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      if (outcome.kind === 'reauth') {
        setCloudError('Your session expired. Sign in again to download.');
        // Resume the download after login (closure for credentials logins,
        // sessionStorage intent for OAuth reloads — see studio page).
        setPendingDownload(() => { void handleDownloadCloud(id); });
        stashPendingDownloadExportId(id);
        onAuthRequired?.();
        return;
      }
      setCloudError(outcome.message);
    } catch {
      setCloudError('Download failed. Please try again.');
    }
  }, [onAuthRequired]);

  const handleDownloadLocal = useCallback((exp: LocalExport) => {
    const url = URL.createObjectURL(exp.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exp.platform}-${exp.outputWidth}x${exp.outputHeight}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke until the browser has started fetching the blob —
    // synchronous revoke can abort the download and orphan in-flight blob GETs.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-text-primary">Recordings</h2>
            <p className="mt-1 text-xs text-text-secondary">Your original recordings · Available for 24 hours</p>
          </div>
          <span className="shrink-0 text-xs text-text-muted">{recordings.length} {recordings.length === 1 ? 'recording' : 'recordings'}</span>
        </div>
      </div>

      <div className="h-px bg-border-subtle" />

      {/* Recording List */}
      <div className="overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        {!isLoaded ? (
          <div className="flex flex-col gap-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-3 rounded-lg bg-elevated/50 animate-pulse">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-24 bg-border-subtle rounded" />
                      <div className="h-3 w-10 bg-border-subtle rounded" />
                    </div>
                    <div className="h-2.5 w-36 bg-border-subtle rounded mt-1.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : recordings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-accent" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-primary">No recordings yet</p>
            <p className="mt-1 max-w-xs text-xs text-text-secondary">Record a video and it will appear here for 24 hours.</p>
          </div>
        ) : (
          <div className={`grid gap-5 ${recordings.length > 1 ? 'sm:grid-cols-2 xl:grid-cols-3' : 'max-w-2xl'}`}>
            {recordings.map((recording) => (
              <div
                key={recording.id}
                className="group relative overflow-visible rounded-xl border border-border-subtle bg-surface shadow-sm transition-colors hover:border-border-strong"
              >
                {confirmDeleteId === recording.id ? (
                  <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 p-5 text-center">
                    <span className="text-sm font-medium text-text-primary">Delete this recording?</span>
                    <span className="text-xs text-text-secondary">This removes it from local storage.</span>
                    <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(recording.id); }}
                      className="rounded-md bg-red-500/10 px-3 py-1.5 text-xs font-medium text-recording hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      className="rounded-md bg-elevated px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                    >
                      Keep recording
                    </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <RecordingThumbnail recording={recording} />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {editingId === recording.id ? (
                            <input
                              ref={editInputRef}
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onBlur={() => handleSaveRename(recording.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(recording.id);
                                if (e.key === 'Escape') handleCancelRename();
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full max-w-[220px] rounded-md border border-accent bg-canvas px-2 py-1 text-sm font-medium text-text-primary outline-none"
                              maxLength={50}
                            />
                          ) : (
                            <h3 className="truncate text-sm font-semibold text-text-primary">
                              {getDisplayName(recording)}
                            </h3>
                          )}
                        </div>
                        <div className="relative shrink-0" ref={openMenuId === recording.id ? menuRef : undefined}>
                          <button
                            onClick={() => setOpenMenuId((current) => current === recording.id ? null : recording.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                            aria-label={`More actions for ${getDisplayName(recording)}`}
                            aria-expanded={openMenuId === recording.id}
                          >
                            <span aria-hidden="true">•••</span>
                          </button>
                          {openMenuId === recording.id && (
                            <div className="absolute right-0 top-9 z-20 min-w-40 rounded-lg border border-border-default bg-surface p-1 shadow-xl" role="menu">
                              <button onClick={() => { onExportRecording?.(recording); setOpenMenuId(null); }} className="block w-full rounded-md px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated hover:text-text-primary" role="menuitem">Export recording</button>
                              <button onClick={(event) => { handleStartRename(recording, event); setOpenMenuId(null); }} className="block w-full rounded-md px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated hover:text-text-primary" role="menuitem">Rename</button>
                              <button onClick={() => { setDetailsId((current) => current === recording.id ? null : recording.id); setOpenMenuId(null); }} className="block w-full rounded-md px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated hover:text-text-primary" role="menuitem">Details</button>
                              <button onClick={() => { setConfirmDeleteId(recording.id); setOpenMenuId(null); }} className="block w-full rounded-md px-3 py-2 text-left text-xs text-recording hover:bg-red-500/10" role="menuitem">Delete</button>
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-text-secondary">
                        Recorded {formatDate(recording.createdAt)}
                      </p>
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {formatTime(recording.duration)} · {recording.width} × {recording.height} · {formatFileSize(recording.blob.size)}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button onClick={() => setPreviewRecording(recording)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label={`Preview ${getDisplayName(recording)}`}>
                          <PlayIcon className="h-3.5 w-3.5" /> Preview
                        </button>
                        <button onClick={() => onExportRecording?.(recording)} className="min-h-9 rounded-md border border-border-subtle px-3 py-2 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                          Export
                        </button>
                      </div>
                      {detailsId === recording.id && (
                        <div className="mt-3 rounded-md border border-border-subtle bg-elevated/50 p-3 text-[11px] text-text-secondary">
                          <div className="flex items-center gap-1.5 font-medium text-text-primary"><SettingsIcon className="h-3 w-3" /> Recording details</div>
                          <p className="mt-1">Format: {formatRecordingFormat(recording.mimeType, recording.extension)}</p>
                          <p className="mt-0.5">Sound: {recording.hasAudio ? 'With sound' : 'Silent'}</p>
                          <p className="mt-0.5">Saved: On this device · 24 hours</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Exports */}
      <div className="px-4 pb-2 pt-6 sm:px-6 lg:px-8">
        <h3 className="text-base font-semibold text-text-primary">Saved exports</h3>
        <p className="mt-1 text-xs text-text-secondary">
          {isAuthenticated && canUseCloudLibrary ? 'Videos you\'ve exported · Saved in your Creator library' : 'Videos you\'ve exported · Saved for 7 days on this device'}
        </p>
      </div>
      <div className="max-h-[45vh] space-y-2 overflow-y-auto px-4 py-2 sm:px-6 lg:px-8">
        {isAuthenticated && canUseCloudLibrary && (
          <>
            {cloudLoading ? (
              <p className="text-[12px] text-text-secondary">Loading cloud exports...</p>
            ) : cloudError ? (
              <p className="text-[12px] text-recording" role="alert">{cloudError}</p>
            ) : cloudExports.length === 0 ? (
              <p className="text-[12px] text-text-secondary">No cloud exports yet.</p>
            ) : (
              cloudExports.map(exp => {
                const quality = formatQualityLabel(exp.outputHeight);
                return (
                <div key={exp.id} className="p-2.5 rounded-lg bg-elevated border border-border-subtle flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-text-primary truncate">{platformDisplayName(exp.platform)}{quality ? ` · ${quality}` : ''}</span>
                    <span className="text-[11px] text-text-secondary">{exp.outputWidth}×{exp.outputHeight}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                    <span>{formatFileSize(exp.fileSize)}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(exp.createdAt)}</span>
                    <span>·</span>
                    <span>{exportStatusLabel(exp.status)}</span>
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    <button onClick={() => handlePreviewCloud(exp.id)} className="text-[11px] px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20" disabled={previewLoading}>Preview</button>
                    <button onClick={() => handleDownloadCloud(exp.id)} className="text-[11px] px-2 py-1 rounded bg-accent text-white hover:bg-accent-hover">Download</button>
                    <button onClick={() => handleDeleteCloud(exp.id)} className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-recording hover:bg-red-500/20 ml-auto">Delete</button>
                  </div>
                </div>
                );
              })
            )}
          </>
        )}
        {isAuthenticated && canUseCloudLibrary ? (
          localExports.length > 0 ? (
            localExports.map(exp => (
              <div key={exp.id} className="p-2.5 rounded-lg bg-elevated border border-border-subtle flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-text-primary truncate">{exp.platform} (local)</span>
                  <span className="text-[11px] text-text-secondary">{exp.outputWidth}×{exp.outputHeight}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                  <span>{formatFileSize(exp.fileSize)}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(exp.createdAt)}</span>
                </div>
                <div className="flex gap-1.5 mt-1">
                  <button onClick={() => handleDownloadLocal(exp)} className="text-[11px] px-2 py-1 rounded bg-accent text-white hover:bg-accent-hover">Download</button>
                  <button onClick={() => handleDeleteLocal(exp.id)} className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-recording hover:bg-red-500/20 ml-auto">Delete</button>
                </div>
              </div>
            ))
          ) : null
        ) : (
          localExports.length === 0 ? (
            <div className="rounded-lg border border-border-subtle bg-elevated/40 p-4">
              <p className="text-sm font-medium text-text-primary">No saved exports yet</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">Videos you&apos;ve exported will appear here.</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">Your exported videos are saved locally on this device for 7 days.</p>
            </div>
          ) : (
            localExports.map(exp => (
              <div key={exp.id} className="p-2.5 rounded-lg bg-elevated border border-border-subtle flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-text-primary truncate">{exp.platform} (local)</span>
                  <span className="text-[11px] text-text-secondary">{exp.outputWidth}×{exp.outputHeight}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                  <span>{formatFileSize(exp.fileSize)}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(exp.createdAt)}</span>
                </div>
                <div className="flex gap-1.5 mt-1">
                  <button onClick={() => handleDownloadLocal(exp)} className="text-[11px] px-2 py-1 rounded bg-accent text-white hover:bg-accent-hover">Download</button>
                  <button onClick={() => handleDeleteLocal(exp.id)} className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-recording hover:bg-red-500/20 ml-auto">Delete</button>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Footer count */}
      {recordings.length > 0 && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <span className="text-[12px] text-text-secondary">{recordings.length} recording{recordings.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Centered preview modals (recordings + cloud exports) */}
      {previewRecording && (
        <RecordingPreviewModal recording={previewRecording} onClose={() => setPreviewRecording(null)} />
      )}
      {previewUrl && (
        <CloudPreviewModal
          url={previewUrl}
          title="Export preview"
          meta={previewCloudMeta}
          onClose={() => { setPreviewUrl(null); setPreviewCloudMeta(''); }}
        />
      )}
    </div>
  );
}
