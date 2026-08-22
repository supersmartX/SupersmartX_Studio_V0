'use client';

import { useState, useCallback, useEffect } from 'react';
import type { Script } from '@/types';

const STORAGE_KEY = 'sxs-studio-scripts';

function generateId(): string {
  return `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function loadScripts(): Script[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveScripts(scripts: Script[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  } catch {
    // ignore storage access failures
  }
}

export function useLibrary() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setScripts(loadScripts());
    setIsLoaded(true);
  }, []);

  const createScript = useCallback((title: string, content: string = ''): Script => {
    const now = new Date().toISOString();
    const script: Script = {
      id: generateId(),
      title,
      content,
      wordCount: countWords(content),
      createdAt: now,
      updatedAt: now,
    };
    setScripts((prev) => {
      const updated = [script, ...prev];
      saveScripts(updated);
      return updated;
    });
    return script;
  }, []);

  const updateScript = useCallback((id: string, updates: Partial<Pick<Script, 'title' | 'content'>>) => {
    setScripts((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== id) return s;
        const content = updates.content ?? s.content;
        return {
          ...s,
          ...updates,
          content,
          wordCount: countWords(content),
          updatedAt: new Date().toISOString(),
        };
      });
      saveScripts(updated);
      return updated;
    });
  }, []);

  const deleteScript = useCallback((id: string) => {
    setScripts((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      saveScripts(updated);
      return updated;
    });
  }, []);

  const getScript = useCallback((id: string): Script | undefined => {
    return scripts.find((s) => s.id === id);
  }, [scripts]);

  const searchScripts = useCallback((query: string): Script[] => {
    if (!query.trim()) return scripts;
    const q = query.toLowerCase();
    return scripts.filter(
      (s) => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
    );
  }, [scripts]);

  return {
    scripts,
    isLoaded,
    createScript,
    updateScript,
    deleteScript,
    getScript,
    searchScripts,
  };
}
