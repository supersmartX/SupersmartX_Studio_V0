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

export function hasPendingDownload(): boolean {
  return pendingDownloadFn !== null;
}

// OAuth (redirect) logins wipe module state on reload, so a download intent
// stashed in sessionStorage survives navigation. Credentials logins keep the
// live closure above; the intent key is consumed (cleared) either way to
// avoid stale reuse.
const PENDING_DOWNLOAD_EXPORT_KEY = 'sxs-pending-download-export-id';

export function stashPendingDownloadExportId(exportId: string) {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(PENDING_DOWNLOAD_EXPORT_KEY, exportId);
    } catch {
      // ignore — private mode etc.
    }
  }
}

export function consumePendingDownloadExportId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(PENDING_DOWNLOAD_EXPORT_KEY);
    window.sessionStorage.removeItem(PENDING_DOWNLOAD_EXPORT_KEY);
    return value;
  } catch {
    return null;
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
