'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { MasterRecording } from '@/types';
import { getLatestRecording, saveRecording, cleanupExpired, deleteRecording } from '@/lib/recording-store';

interface UseMasterRecordingReturn {
  masterRecording: MasterRecording | null;
  setMasterRecording: (recording: MasterRecording | null) => void;
  createMasterRecording: (blob: Blob, duration: number, hasAudio: boolean, sourceWidth?: number, sourceHeight?: number) => MasterRecording;
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

  const clearMasterRecording = useCallback(() => {
    const current = masterRef.current;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = '';
    }
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
    clearMasterRecording,
    restoreMasterRecording,
    isRestored,
  };
}
