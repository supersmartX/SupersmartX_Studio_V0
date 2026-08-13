'use client';

import { useState, useCallback } from 'react';

interface ToastState {
  message: string;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string) => {
    setToast({ message });
    setTimeout(() => setToast(null), 2700);
  }, []);

  return {
    toast,
    showToast,
  };
}
