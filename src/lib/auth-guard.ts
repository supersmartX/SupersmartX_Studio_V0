import { Session } from 'next-auth';

const PENDING_DOWNLOAD_KEY = 'sxs-pending-download';

export function setPendingDownload(fn: () => void) {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(PENDING_DOWNLOAD_KEY, Date.now().toString());
    (window as any).__sxsPendingDownload = fn;
  }
}

export function executePendingDownload() {
  if (typeof window !== 'undefined') {
    const fn = (window as any).__sxsPendingDownload;
    if (fn) {
      (window as any).__sxsPendingDownload = null;
      sessionStorage.removeItem(PENDING_DOWNLOAD_KEY);
      fn();
    }
  }
}

export function clearPendingDownload() {
  if (typeof window !== 'undefined') {
    (window as any).__sxsPendingDownload = null;
    sessionStorage.removeItem(PENDING_DOWNLOAD_KEY);
  }
}

export function requireAuthForDownload(
  session: Session | null,
  onDownload: () => void,
  onAuthRequired: () => void
) {
  if (session?.user) {
    onDownload();
  } else {
    setPendingDownload(onDownload);
    onAuthRequired();
  }
}