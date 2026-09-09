import { Session } from 'next-auth';

let pendingDownloadFn: (() => void) | null = null;

export function setPendingDownload(fn: () => void) {
  if (typeof window !== 'undefined') {
    pendingDownloadFn = fn;
  }
}

export function executePendingDownload() {
  if (typeof window !== 'undefined') {
    const fn = pendingDownloadFn;
    pendingDownloadFn = null;
    if (fn) {
      fn();
    }
  }
}

export function clearPendingDownload() {
  if (typeof window !== 'undefined') {
    pendingDownloadFn = null;
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
