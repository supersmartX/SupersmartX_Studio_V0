'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface ToastState {
  message: string;
  id: number;
}

let toastId = 0;

export function useToast() {
  const [toastQueue, setToastQueue] = useState<ToastState[]>([]);
  const [currentToast, setCurrentToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<ToastState[]>([]);
  const hasActiveToast = useRef(false);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const processQueue = useCallback(() => {
    if (queueRef.current.length === 0) {
      hasActiveToast.current = false;
      setCurrentToast(null);
      return;
    }
    const next = queueRef.current.shift()!;
    hasActiveToast.current = true;
    setCurrentToast(next);
    setToastQueue([...queueRef.current]);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      processQueue();
    }, 2700);
  }, []);

  const showToast = useCallback((message: string) => {
    const id = ++toastId;
    const entry: ToastState = { message, id };

    if (hasActiveToast.current) {
      queueRef.current.push(entry);
      setToastQueue([...queueRef.current]);
    } else {
      hasActiveToast.current = true;
      setCurrentToast(entry);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        processQueue();
      }, 2700);
    }
  }, [processQueue]);

  return {
    toast: currentToast,
    showToast,
    queueLength: toastQueue.length,
  };
}
