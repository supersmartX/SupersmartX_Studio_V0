import { Session } from 'next-auth';

let pendingDownload: (() => void) | null = null;

export function setPendingDownload(fn: () => void) {
  pendingDownload = fn;
}

export function executePendingDownload() {
  if (pendingDownload) {
    const fn = pendingDownload;
    pendingDownload = null;
    fn();
  }
}

export function clearPendingDownload() {
  pendingDownload = null;
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
