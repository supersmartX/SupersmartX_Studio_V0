'use client';

import { useState, useCallback } from 'react';
import type { Script } from '@/types';
import { CloseIcon } from '@/components/icons';

interface LibraryPanelProps {
  scripts: Script[];
  isLoaded: boolean;
  onCreateScript: (title: string, content?: string) => Script;
  onUpdateScript: (id: string, updates: { title?: string; content?: string }) => void;
  onDeleteScript: (id: string) => void;
  onSearchScripts: (query: string) => Script[];
  onLoadScript: (content: string) => void;
  currentContent: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function LibraryPanel({
  scripts,
  isLoaded,
  onCreateScript,
  onUpdateScript,
  onDeleteScript,
  onSearchScripts,
  onLoadScript,
  currentContent,
}: LibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const displayedScripts = searchQuery ? onSearchScripts(searchQuery) : scripts;

  const handleCreate = useCallback(() => {
    const script = onCreateScript('Untitled Script', currentContent);
    setEditingId(script.id);
    setEditTitle(script.title);
  }, [onCreateScript, currentContent]);

  const handleStartEdit = useCallback((script: Script) => {
    setEditingId(script.id);
    setEditTitle(script.title);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingId && editTitle.trim()) {
      onUpdateScript(editingId, { title: editTitle.trim() });
    }
    setEditingId(null);
    setEditTitle('');
  }, [editingId, editTitle, onUpdateScript]);

  const handleLoadToEditor = useCallback((script: Script) => {
    onLoadScript(script.content);
  }, [onLoadScript]);

  const handleConfirmDelete = useCallback((id: string) => {
    setConfirmDeleteId(id);
  }, []);

  const handleDelete = useCallback(() => {
    if (confirmDeleteId) {
      onDeleteScript(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, onDeleteScript]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Library</h2>
          <button
            onClick={handleCreate}
            className="text-[11px] font-medium text-accent hover:text-accent/80 transition-colors"
          >
            + New Script
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search scripts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-elevated border border-border-subtle rounded-lg pl-9 pr-3 py-2 text-xs text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      <div className="h-px bg-border-subtle" />

      {/* Script List */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {!isLoaded ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-text-muted">Loading...</span>
          </div>
        ) : displayedScripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-accent" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <p className="text-xs text-text-muted">
              {searchQuery ? 'No scripts match your search.' : 'No scripts yet. Create one to get started.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {displayedScripts.map((script) => (
              <div
                key={script.id}
                className="group relative p-3 rounded-lg hover:bg-elevated transition-colors cursor-pointer"
                onClick={() => handleLoadToEditor(script)}
              >
                {confirmDeleteId === script.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-recording">Delete?</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(); }}
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
                ) : editingId === script.id ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      onBlur={handleSaveEdit}
                      autoFocus
                      className="flex-1 bg-canvas border border-accent rounded px-2 py-1 text-xs text-text-primary outline-none"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-medium text-text-primary truncate">{script.title}</h4>
                        <p className="text-[10px] text-text-muted mt-0.5 truncate">
                          {script.wordCount} words · {formatRelativeTime(script.updatedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStartEdit(script); }}
                          className="p-1 rounded hover:bg-border-default transition-colors"
                          aria-label="Rename"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-text-muted" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleConfirmDelete(script.id); }}
                          className="p-1 rounded hover:bg-red-500/10 transition-colors"
                          aria-label="Delete"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-recording" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {script.content && (
                      <p className="text-[10px] text-text-muted/60 mt-1 line-clamp-2 leading-relaxed">
                        {script.content.slice(0, 120)}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer count */}
      {scripts.length > 0 && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <span className="text-[10px] text-text-muted">{scripts.length} script{scripts.length !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
