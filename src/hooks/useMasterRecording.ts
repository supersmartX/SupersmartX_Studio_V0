'use client';

import { useState, useCallback, useRef } from 'react';
import type { MasterRecording } from '@/types';
import { getRecording, saveRecording, cleanupExpired } from '@/lib/recording-store';

interface UseMasterRecordingReturn {
  masterRecording: MasterRecording | null;
  setMasterRecording: (recording: MasterRecording | null) => void;
  createMasterRecording: (blob: Blob, duration: number, hasAudio: boolean, sourceWidth?: number, sourceHeight?: number) => MasterRecording;
  clearMasterRecording: () => void;
  restoreMasterRecording: () => Promise<boolean>;
}

export function useMasterRecording(): UseMasterRecordingReturn {
  const [masterRecording, setMasterRecording] = useState<MasterRecording | null>(null);
  const blobUrlRef = useRef<string>('');

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

      saveRecording({
        id: recording.id,
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
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = '';
    }
    setMasterRecording(null);
  }, []);

  const restoreMasterRecording = useCallback(async (): Promise<boolean> => {
    try {
      const stored = await getRecording('latest');
      if (!stored) return false;

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
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    masterRecording,
    setMasterRecording,
    createMasterRecording,
    clearMasterRecording,
    restoreMasterRecording,
  };
}
