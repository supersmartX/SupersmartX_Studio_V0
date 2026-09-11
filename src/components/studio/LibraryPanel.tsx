'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAllRecordings, deleteRecording, renameRecording, type StoredRecording } from '@/lib/recording-store';
import { formatTime, formatRelativeTime } from '@/utils/format';

interface RecordingsPanelProps {
  onLoadRecording?: (recording: StoredRecording) => void;
  onExportRecording?: (recording: StoredRecording) => void;
  isMobile?: boolean;
}

export function RecordingsPanel({ onLoadRecording, onExportRecording, isMobile }: RecordingsPanelProps) {
  const [recordings, setRecordings] = useState<StoredRecording[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

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

  const handleLoad = useCallback((recording: StoredRecording) => {
    onLoadRecording?.(recording);
  }, [onLoadRecording]);

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
    return recording.name || `${recording.extension.toUpperCase()} Recording`;
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-sm font-semibold text-text-primary">Recordings</h2>
        <p className="text-[12px] text-text-secondary mt-0.5">Stored locally for 24 hours</p>
      </div>

      <div className="h-px bg-border-subtle" />

      {/* Recording List */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
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
            <p className="text-[13px] text-text-secondary">No recordings yet.</p>
            <p className="text-[12px] text-text-secondary mt-1">Record a video to see it here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {recordings.map((recording) => (
              <div
                key={recording.id}
                role="button"
                tabIndex={0}
                className="group relative p-3 rounded-lg hover:bg-elevated transition-colors cursor-pointer"
                onClick={() => { if (editingId !== recording.id) handleLoad(recording); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (editingId !== recording.id) handleLoad(recording); } }}
              >
                {confirmDeleteId === recording.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-recording">Delete?</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(recording.id); }}
                      className="text-[10px] font-medium text-recording hover:text-red-300 px-2 py-0.5 rounded bg-red-500/10"
                    >
                      Yes
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      className="text-[10px] font-medium text-text-muted hover:text-text-secondary px-2 py-0.5 rounded bg-elevated"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
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
                              className="text-xs font-medium text-text-primary bg-canvas border border-accent rounded px-1.5 py-0.5 outline-none w-full max-w-[200px]"
                              maxLength={50}
                            />
                          ) : (
                            <h4 className="text-xs font-medium text-text-primary truncate">
                              {getDisplayName(recording)}
                            </h4>
                          )}
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-elevated text-text-secondary border border-border-subtle">
                            {recording.aspectRatio}
                          </span>
                        </div>
                        <p className="text-[12px] text-text-secondary mt-0.5">
                          {formatTime(recording.duration)} · {recording.width}×{recording.height} · {formatRelativeTime(recording.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); onExportRecording?.(recording); }}
                          className="p-1 rounded hover:bg-accent/10 transition-colors"
                          aria-label="Export recording"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-accent" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => handleStartRename(recording, e)}
                          className="p-1 rounded hover:bg-accent/10 transition-colors"
                          aria-label="Rename recording"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-text-muted" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(recording.id); }}
                          className="p-1 rounded hover:bg-red-500/10 transition-colors"
                          aria-label="Delete recording"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-recording" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {recording.hasAudio && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                          Audio
                        </span>
                      )}
                      <span className="text-[11px] text-text-secondary">
                        {recording.mimeType}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer count */}
      {recordings.length > 0 && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <span className="text-[12px] text-text-secondary">{recordings.length} recording{recordings.length !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
