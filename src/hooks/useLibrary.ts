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

  const persist = useCallback((updated: Script[]) => {
    setScripts(updated);
    saveScripts(updated);
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
    persist([script, ...loadScripts()]);
    return script;
  }, [persist]);

  const updateScript = useCallback((id: string, updates: Partial<Pick<Script, 'title' | 'content'>>) => {
    const all = loadScripts();
    const updated = all.map((s) => {
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
    persist(updated);
  }, [persist]);

  const deleteScript = useCallback((id: string) => {
    persist(loadScripts().filter((s) => s.id !== id));
  }, [persist]);

  const getScript = useCallback((id: string): Script | undefined => {
    return loadScripts().find((s) => s.id === id);
  }, []);

  const searchScripts = useCallback((query: string): Script[] => {
    if (!query.trim()) return loadScripts();
    const q = query.toLowerCase();
    return loadScripts().filter(
      (s) => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
    );
  }, []);

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
