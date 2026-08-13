'use client';

import { useState, useCallback } from 'react';

export function useFocusView() {
  const [isEnabled, setIsEnabled] = useState(false);

  const toggle = useCallback(() => {
    setIsEnabled((prev) => !prev);
  }, []);

  return {
    isEnabled,
    toggle,
  };
}
