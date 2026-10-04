'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { MasterRecording } from '@/types';
import { getLatestRecording, saveRecording, cleanupExpired, deleteRecording, type StoredRecording } from '@/lib/recording-store';

interface UseMasterRecordingReturn {
  masterRecording: MasterRecording | null;
  setMasterRecording: (recording: MasterRecording | null) => void;
  /**
   * Workflow A only. A NEW master: mints an id and persists a new row.
   * Never use this to attach to a take that is already in the library — that
   * would duplicate the recording (see `openStoredRecording`).
   */
  createMasterRecording: (blob: Blob, duration: number, hasAudio: boolean, sourceWidth?: number, sourceHeight?: number) => MasterRecording;
  /**
   * Workflow B only. Attach an EXISTING library recording: adopts the stored
   * row's identity verbatim and never writes a new row, so previewing or
   * exporting it can never fork the master into a second recording.
   */
  openStoredRecording: (stored: StoredRecording) => MasterRecording;
  /**
   * "New Video": drop the active session's hold on the current take WITHOUT
   * deleting it. The take stays in the library and stays reachable from there.
   */
  releaseMasterRecording: () => void;
  /**
   * Explicit discard ("Record Again"). Destroys the stored bytes.
   */
  clearMasterRecording: () => void;
  restoreMasterRecording: () => Promise<boolean>;
  /**
   * True when the current master came back out of IndexedDB rather than out of
   * a take finished in THIS document. Every cross-document hop — Google OAuth,
   * the Cashfree redirect, the return trip, a reload, a session refresh —
   * destroys `recordingState`, so this is the only signal the studio has that a
   * finished take is waiting to be reviewed again.
   */
  isRestored: boolean;
}

export function useMasterRecording(): UseMasterRecordingReturn {
  const [masterRecording, setMasterRecording] = useState<MasterRecording | null>(null);
  const [isRestored, setIsRestored] = useState(false);
  const blobUrlRef = useRef<string>('');
  // Latest-value ref: the restore read is async, so it must be able to see a
  // master that was created while the read was in flight.
  const masterRef = useRef<MasterRecording | null>(null);
  const restoreStartedRef = useRef(false);
  // Set when the user explicitly started a clean creation session ("New
  // Video"). The restore read is async, so without this a read already in
  // flight when "New Video" was clicked would land afterwards and re-attach the
  // very take the user just asked to leave behind.
  const newSessionRef = useRef(false);

  masterRef.current = masterRecording;

  const createMasterRecording = useCallback(
    (blob: Blob, duration: number, hasAudio: boolean, sourceWidth = 0, sourceHeight = 0): MasterRecording => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }

      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const recording: MasterRecording = {
        id: `master-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        blob,
        url,
        mimeType: blob.type || 'video/webm',
        extension: blob.type?.includes('mp4') ? 'mp4' : 'webm',
        duration,
        hasAudio,
        sourceWidth,
        sourceHeight,
        createdAt: new Date().toISOString(),
      };

      // A take finished in this document is authoritative: it clears the
      // "clean new session" latch so the pending restore path stays usable.
      newSessionRef.current = false;

      setMasterRecording(recording);
      masterRef.current = recording;
      setIsRestored(false);

      saveRecording({
        id: recording.id,
        name: '',
        blob: recording.blob,
        mimeType: recording.mimeType,
        extension: recording.extension,
        duration: recording.duration,
        hasAudio: recording.hasAudio,
        width: recording.sourceWidth,
        height: recording.sourceHeight,
        aspectRatio: '16:9',
        createdAt: recording.createdAt,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).catch(() => {});

      cleanupExpired().catch(() => {});

      return recording;
    },
    []
  );

  // Workflow B — operate on an EXISTING library recording.
  //
  // This is the difference between "record a new video" and "work with a video I
  // already made". Routing a library selection through createMasterRecording
  // minted a fresh `master-<ts>-<rand>` id and re-saved the row, so every open
  // forked the master into a second, identical library item and the original id
  // was orphaned. Here the stored row IS the master: same id, same bytes, no
  // write. Changing platform or exporting repeatedly re-reads this one record.
  const openStoredRecording = useCallback((stored: StoredRecording): MasterRecording => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }

    const url = URL.createObjectURL(stored.blob);
    blobUrlRef.current = url;

    const recording: MasterRecording = {
      id: stored.id,
      blob: stored.blob,
      url,
      mimeType: stored.mimeType,
      extension: stored.extension,
      duration: stored.duration,
      hasAudio: stored.hasAudio,
      sourceWidth: stored.width,
      sourceHeight: stored.height,
      createdAt: stored.createdAt,
    };

    // The user deliberately selected this take, so the "clean new session"
    // latch must not block anything — but nothing is being restored behind the
    // user's back either, hence isRestored = true: this take came out of
    // storage and reviews exactly like a restored one.
    newSessionRef.current = false;
    restoreStartedRef.current = true;

    setMasterRecording(recording);
    masterRef.current = recording;
    setIsRestored(true);
    return recording;
  }, []);

  // "New Video" — end the active creation session without destroying anything.
  //
  // Deliberately NOT clearMasterRecording: that deletes the IndexedDB row, which
  // is the only copy of the bytes. "New Video" must leave the previous take in
  // the library, reachable only from there.
  const releaseMasterRecording = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = '';
    }
    newSessionRef.current = true;
    setMasterRecording(null);
    masterRef.current = null;
    setIsRestored(false);
  }, []);

  const clearMasterRecording = useCallback(() => {
    const current = masterRef.current;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = '';
    }
    newSessionRef.current = true;
    setMasterRecording(null);
    masterRef.current = null;
    setIsRestored(false);
    // The IndexedDB row is the only copy of these bytes. Leaving it behind
    // meant "record again" / "open library" merely HID the take: the next
    // restore pulled the very same recording straight back out of storage.
    if (current) {
      void deleteRecording(current.id);
    }
  }, []);

  const restoreMasterRecording = useCallback(async (): Promise<boolean> => {
    // "New Video" ended the previous session. A restore that was already in
    // flight must not resurrect the take the user just walked away from.
    if (newSessionRef.current) return false;
    // One attempt per document. Without this an explicit discard re-triggers
    // the page's restore effect, which resurrects the take the user just threw
    // away — and lands them back in review with no way to leave.
    if (restoreStartedRef.current) return false;
    restoreStartedRef.current = true;

    try {
      const stored = await getLatestRecording();
      if (!stored) return false;
      // A take recorded while the read was in flight always wins: it is newer
      // than the row we just read, and it is the one the user is looking at.
      if (masterRef.current) return false;

      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }

      const url = URL.createObjectURL(stored.blob);
      blobUrlRef.current = url;

      const recording: MasterRecording = {
        id: stored.id,
        blob: stored.blob,
        url,
        mimeType: stored.mimeType,
        extension: stored.extension,
        duration: stored.duration,
        hasAudio: stored.hasAudio,
        sourceWidth: stored.width,
        sourceHeight: stored.height,
        createdAt: stored.createdAt,
      };

      setMasterRecording(recording);
      masterRef.current = recording;
      setIsRestored(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  return {
    masterRecording,
    setMasterRecording,
    createMasterRecording,
    openStoredRecording,
    releaseMasterRecording,
    clearMasterRecording,
    restoreMasterRecording,
    isRestored,
  };
}
