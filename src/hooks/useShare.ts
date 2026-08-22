'use client';

import { useCallback } from 'react';

export function useShare(showToast: (message: string) => void) {
  const share = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'SupersmartX Studio',
          text: 'Check out SupersmartX Studio — Record professional videos with a built-in teleprompter.',
          url: window.location.href,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Link copied to clipboard');
      } catch {
        showToast('Failed to copy link');
      }
    }
  }, [showToast]);

  return { share };
}
