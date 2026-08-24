'use client';

import { useState, useCallback, useRef } from 'react';
import type { ExportConfig, ExportJob, CropConfig, PlatformId, MasterRecording } from '@/types';
import { PLATFORM_PRESETS } from '@/constants';

interface UseExportPipelineReturn {
  exportConfig: ExportConfig | null;
  exportJobs: ExportJob[];
  setExportConfig: (config: ExportConfig | null) => void;
  selectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number) => ExportConfig;
  updateCrop: (updates: Partial<CropConfig>) => void;
  resetCrop: () => void;
  startExport: (master: MasterRecording) => Promise<ExportJob>;
  startBatchExport: (master: MasterRecording, configs: ExportConfig[]) => Promise<ExportJob[]>;
  cancelExport: (jobId: string) => void;
  clearJobs: () => void;
  generateThumbnail: (master: MasterRecording, timeSeconds?: number) => Promise<string>;
}

function getDefaultCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): CropConfig {
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = sourceWidth / sourceHeight;

  let cropWidth: number;
  let cropHeight: number;

  if (targetRatio > sourceRatio) {
    cropWidth = sourceWidth;
    cropHeight = sourceWidth / targetRatio;
  } else {
    cropHeight = sourceHeight;
    cropWidth = sourceHeight * targetRatio;
  }

  return {
    x: (sourceWidth - cropWidth) / 2,
    y: (sourceHeight - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
    zoom: 1,
  };
}

export function useExportPipeline(): UseExportPipelineReturn {
  const [exportConfig, setExportConfig] = useState<ExportConfig | null>(null);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const abortControllerRef = useRef<Map<string, AbortController>>(new Map());
  const sourceDimensionsRef = useRef<{ width: number; height: number }>({ width: 1920, height: 1080 });

  const selectPlatform = useCallback(
    (platformId: PlatformId, sourceWidth: number, sourceHeight: number): ExportConfig => {
      sourceDimensionsRef.current = { width: sourceWidth, height: sourceHeight };

      const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
      if (!preset) {
        const outW = sourceWidth;
        const outH = Math.round(sourceWidth / (16 / 9));
        const config: ExportConfig = {
          platformId: 'custom',
          aspectRatio: '16:9',
          outputWidth: outW,
          outputHeight: outH,
          crop: getDefaultCrop(sourceWidth, sourceHeight, outW, outH),
        };
        setExportConfig(config);
        return config;
      }

      const config: ExportConfig = {
        platformId,
        aspectRatio: preset.aspectRatio,
        outputWidth: preset.width,
        outputHeight: preset.height,
        crop: getDefaultCrop(sourceWidth, sourceHeight, preset.width, preset.height),
      };

      setExportConfig(config);
      return config;
    },
    []
  );

  const updateCrop = useCallback(
    (updates: Partial<CropConfig>) => {
      setExportConfig((prev) => {
        if (!prev) return prev;
        return { ...prev, crop: { ...prev.crop, ...updates } };
      });
    },
    []
  );

  const resetCrop = useCallback(() => {
    setExportConfig((prev) => {
      if (!prev) return prev;
      const sd = sourceDimensionsRef.current;
      return {
        ...prev,
        crop: getDefaultCrop(sd.width, sd.height, prev.outputWidth, prev.outputHeight),
      };
    });
  }, []);

  const startExport = useCallback(
    async (master: MasterRecording): Promise<ExportJob> => {
      if (!exportConfig) {
        throw new Error('No export config');
      }

      const jobId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const abortController = new AbortController();
      abortControllerRef.current.set(jobId, abortController);

      const job: ExportJob = {
        id: jobId,
        masterId: master.id,
        config: exportConfig,
        status: 'encoding',
      };

      setExportJobs((prev) => [...prev, job]);

      try {
        const resultBlob = await encodeExport(master, exportConfig, abortController.signal);
        const resultUrl = URL.createObjectURL(resultBlob);

        const completedJob: ExportJob = {
          ...job,
          status: 'done',
          resultUrl,
          resultBlob,
        };

        setExportJobs((prev) => prev.map((j) => (j.id === jobId ? completedJob : j)));
        abortControllerRef.current.delete(jobId);

        return completedJob;
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === 'AbortError';
        const failedJob: ExportJob = {
          ...job,
          status: isAbort ? 'pending' : 'error',
          error: isAbort ? undefined : error instanceof Error ? error.message : 'Export failed',
        };

        setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
        abortControllerRef.current.delete(jobId);

        return failedJob;
      }
    },
    [exportConfig]
  );

  const startBatchExport = useCallback(
    async (master: MasterRecording, configs: ExportConfig[]): Promise<ExportJob[]> => {
      const results: ExportJob[] = [];
      for (const config of configs) {
        setExportConfig(config);
        await new Promise((r) => setTimeout(r, 100));
        const job = await startExport(master);
        results.push(job);
      }
      return results;
    },
    [startExport, setExportConfig]
  );

  const cancelExport = useCallback((jobId: string) => {
    const controller = abortControllerRef.current.get(jobId);
    if (controller) {
      controller.abort();
      abortControllerRef.current.delete(jobId);
    }
    setExportJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const clearJobs = useCallback(() => {
    abortControllerRef.current.forEach((controller) => controller.abort());
    abortControllerRef.current.clear();
    setExportJobs((prev) => {
      prev.forEach((job) => {
        if (job.resultUrl) URL.revokeObjectURL(job.resultUrl);
      });
      return [];
    });
  }, []);

  const generateThumbnail = useCallback(
    async (master: MasterRecording, timeSeconds = 1): Promise<string> => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      document.body.appendChild(video);

      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Thumbnail load timeout')), 10000);
          video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
          video.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load video for thumbnail')); };
          video.src = master.url;
        });

        video.currentTime = Math.min(timeSeconds, video.duration || 1);
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });

        const canvas = document.createElement('canvas');
        const thumbWidth = 320;
        const thumbHeight = Math.round((video.videoHeight / video.videoWidth) * thumbWidth) || 180;
        canvas.width = thumbWidth;
        canvas.height = thumbHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context not available');

        ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);

        return canvas.toDataURL('image/jpeg', 0.7);
      } finally {
        video.src = '';
        video.load();
        if (video.parentNode) {
          video.parentNode.removeChild(video);
        }
      }
    },
    []
  );

  return {
    exportConfig,
    exportJobs,
    setExportConfig,
    selectPlatform,
    updateCrop,
    resetCrop,
    startExport,
    startBatchExport,
    cancelExport,
    clearJobs,
    generateThumbnail,
  };
}

async function encodeExport(
  master: MasterRecording,
  config: ExportConfig,
  signal?: AbortSignal
): Promise<Blob> {
  const { crop, outputWidth, outputHeight } = config;

  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  document.body.appendChild(video);

  let audioContext: AudioContext | null = null;
  let audioSource: MediaElementAudioSourceNode | null = null;
  let audioDestination: MediaStreamAudioDestinationNode | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video load timeout')), 30000);
      video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
      video.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load video for export')); };
      video.src = master.url;
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const sourceW = video.videoWidth || 1920;
    const sourceH = video.videoHeight || 1080;

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');

    const videoStream = canvas.captureStream(30);

    let combinedStream: MediaStream;

    if (master.hasAudio) {
      try {
        audioContext = new AudioContext();
        audioSource = audioContext.createMediaElementSource(video);
        audioDestination = audioContext.createMediaStreamDestination();
        audioSource.connect(audioDestination);

        combinedStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioDestination.stream.getAudioTracks(),
        ]);
      } catch {
        combinedStream = videoStream;
      }
    } else {
      combinedStream = videoStream;
    }

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: master.hasAudio ? 128_000 : undefined,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recordingDone = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.onerror = () => reject(new Error('MediaRecorder error'));
    });

    const abortHandler = () => {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop();
      }
      video.pause();
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    recorder.start(100);

    if (audioContext?.state === 'suspended') {
      await audioContext.resume();
    }
    await video.play();

    await new Promise<void>((resolve) => {
      const frameInterval = setInterval(() => {
        if (signal?.aborted || video.ended || video.paused) {
          clearInterval(frameInterval);
          if (recorder.state === 'recording' || recorder.state === 'paused') {
            recorder.stop();
          }
          resolve();
          return;
        }

        const sx = (crop.x / 1920) * sourceW;
        const sy = (crop.y / 1080) * sourceH;
        const sw = (crop.width / 1920) * sourceW;
        const sh = (crop.height / 1080) * sourceH;

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
      }, 1000 / 30);

      video.onended = () => {
        clearInterval(frameInterval);
        if (recorder.state === 'recording' || recorder.state === 'paused') {
          recorder.stop();
        }
        resolve();
      };
    });

    signal?.removeEventListener('abort', abortHandler);

    const resultBlob = await recordingDone;
    return resultBlob;
  } finally {
    if (audioSource) {
      try { audioSource.disconnect(); } catch {}
    }
    if (audioContext) {
      try { await audioContext.close(); } catch {}
    }
    video.src = '';
    video.load();
    if (video.parentNode) {
      video.parentNode.removeChild(video);
    }
  }
}
