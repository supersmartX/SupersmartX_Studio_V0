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

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const processQueue = useCallback(() => {
    if (queueRef.current.length === 0) {
      setCurrentToast(null);
      return;
    }
    const next = queueRef.current.shift()!;
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

    if (currentToast) {
      queueRef.current.push(entry);
      setToastQueue([...queueRef.current]);
    } else {
      setCurrentToast(entry);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        processQueue();
      }, 2700);
    }
  }, [currentToast, processQueue]);

  return {
    toast: currentToast,
    showToast,
    queueLength: toastQueue.length,
  };
}
