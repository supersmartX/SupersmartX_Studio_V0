'use client';

import { useState, useCallback, useRef } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { ExportConfig, ExportJob, CropConfig, PlatformId, MasterRecording } from '@/types';
import { PLATFORM_PRESETS } from '@/constants';

interface UseExportPipelineReturn {
  exportConfig: ExportConfig | null;
  exportJobs: ExportJob[];
  setExportConfig: (config: ExportConfig | null) => void;
  selectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number) => ExportConfig;
  updateCrop: (updates: Partial<CropConfig>) => void;
  resetCrop: () => void;
  startExport: (master: MasterRecording, onProgress?: (progress: number) => void) => Promise<ExportJob>;
  startBatchExport: (master: MasterRecording, configs: ExportConfig[], onProgress?: (batchIndex: number, progress: number) => void) => Promise<ExportJob[]>;
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
    async (master: MasterRecording, onProgress?: (progress: number) => void): Promise<ExportJob> => {
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
        const resultBlob = await encodeExport(master, exportConfig, abortController.signal, onProgress);

        if (resultBlob.size < 100) {
          const failedJob: ExportJob = {
            ...job,
            status: 'error',
            error: 'Export produced an empty file. The video may not have played correctly.',
          };
          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
          abortControllerRef.current.delete(jobId);
          return failedJob;
        }

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
    async (master: MasterRecording, configs: ExportConfig[], onProgress?: (batchIndex: number, progress: number) => void): Promise<ExportJob[]> => {
      const results: ExportJob[] = [];
      for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        sourceDimensionsRef.current = { width: master.sourceWidth || 1920, height: master.sourceHeight || 1080 };
        setExportConfig(config);

        const jobId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const abortController = new AbortController();
        abortControllerRef.current.set(jobId, abortController);

        const job: ExportJob = { id: jobId, masterId: master.id, config, status: 'encoding' };
        setExportJobs((prev) => [...prev, job]);

        try {
          const resultBlob = await encodeExport(master, config, abortController.signal, (p) => onProgress?.(i, p));
          const resultUrl = URL.createObjectURL(resultBlob);
          const completedJob: ExportJob = { ...job, status: 'done', resultUrl, resultBlob };
          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? completedJob : j)));
          results.push(completedJob);
        } catch (error) {
          const failedJob: ExportJob = { ...job, status: 'error', error: error instanceof Error ? error.message : 'Failed' };
          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
          results.push(failedJob);
        }
        abortControllerRef.current.delete(jobId);
      }
      return results;
    },
    []
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

function getAvcCodec(width: number, height: number): string {
  const pixels = width * height;
  // Level 4.0 (0x28): max 2,073,600 pixels — covers 1920x1080, 1080x1080, 1080x1920
  // Level 4.1 (0x2a): same max, better tooling support
  // Level 5.1 (0x34): max 8,294,400 pixels — covers 4K (3840x2160)
  // High Profile (0x64) for best compression efficiency
  if (pixels > 2_073_600) {
    return 'avc1.640034'; // High Profile, Level 5.1 (4K)
  }
  return 'avc1.640028'; // High Profile, Level 4.0 (up to 1080p)
}

async function encodeExport(
  master: MasterRecording,
  config: ExportConfig,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const { crop, outputWidth, outputHeight } = config;

  const videoEl = document.createElement('video');
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.preload = 'auto';
  videoEl.crossOrigin = 'anonymous';
  videoEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(videoEl);

  let audioCtx: AudioContext | null = null;
  let audioSrc: MediaElementAudioSourceNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video load timeout')), 30000);
      videoEl.onloadeddata = () => { clearTimeout(timeout); resolve(); };
      videoEl.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load video for export')); };
      videoEl.src = master.url;
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const sourceW = videoEl.videoWidth || 1920;
    const sourceH = videoEl.videoHeight || 1080;

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');

    const fps = 30;
    const frameDuration = 1_000_000 / fps;
    const frameIntervalMs = 1000 / fps;

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: outputWidth,
        height: outputHeight,
        frameRate: fps,
      },
      audio: master.hasAudio ? {
        codec: 'aac',
        numberOfChannels: 2,
        sampleRate: 48000,
      } : undefined,
      fastStart: 'fragmented',
      firstTimestampBehavior: 'offset',
    });

    const videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        muxer.addVideoChunk(chunk, metadata);
      },
      error: (e) => { throw e; },
    });
    videoEncoder.configure({
      codec: getAvcCodec(outputWidth, outputHeight),
      width: outputWidth,
      height: outputHeight,
      bitrate: 10_000_000,
      bitrateMode: 'constant',
    });

    let audioEncoder: AudioEncoder | null = null;
    if (master.hasAudio) {
      try {
        audioCtx = new AudioContext({ sampleRate: 48000 });
        audioSrc = audioCtx.createMediaElementSource(videoEl);

        audioEncoder = new AudioEncoder({
          output: (chunk, metadata) => {
            muxer.addAudioChunk(chunk, metadata);
          },
          error: () => {},
        });
        audioEncoder.configure({
          codec: 'mp4a.40.2',
          numberOfChannels: 2,
          sampleRate: 48000,
          bitrate: 192_000,
        });

        scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
        audioSrc.connect(scriptNode);
        scriptNode.connect(audioCtx.destination);

        let audioTimestamp = 0;
        scriptNode.onaudioprocess = (e) => {
          if (!audioEncoder || audioEncoder.state !== 'configured') return;
          const inputDataL = e.inputBuffer.getChannelData(0);
          const inputDataR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inputDataL;
          const samples = new Float32Array(inputDataL.length * 2);
          for (let i = 0; i < inputDataL.length; i++) {
            samples[i * 2] = inputDataL[i];
            samples[i * 2 + 1] = inputDataR[i];
          }

          const audioData = new AudioData({
            format: 'f32-planar',
            numberOfChannels: 2,
            numberOfFrames: inputDataL.length,
            sampleRate: 48000,
            timestamp: audioTimestamp,
            data: samples,
          });
          audioTimestamp += Math.round((inputDataL.length / 48000) * 1_000_000);
          audioEncoder.encode(audioData);
          audioData.close();
        };
      } catch {
        audioEncoder = null;
      }
    }

    if (audioCtx?.state === 'suspended') {
      await audioCtx.resume();
    }

    try {
      await videoEl.play();
    } catch {
      throw new Error('Video playback blocked. Please try again.');
    }

    if (videoEl.paused) {
      throw new Error('Video failed to start playing.');
    }

    let frameCount = 0;
    const maxQueueSize = 5;
    const totalFrames = Math.ceil((videoEl.duration || 30) * fps);

    const ENCODE_TIMEOUT_MS = Math.max((videoEl.duration || 30) * 1000 * 2, 60000);
    const encodeTimeout = setTimeout(() => {
      videoEl.pause();
    }, ENCODE_TIMEOUT_MS);

    await new Promise<void>((resolve) => {
      const intervalId = setInterval(() => {
        if (signal?.aborted || videoEl.ended || videoEl.paused) {
          clearInterval(intervalId);
          clearTimeout(encodeTimeout);
          resolve();
          return;
        }

        if (videoEncoder.encodeQueueSize > maxQueueSize) {
          return;
        }

        const sx = (crop.x / (master.sourceWidth || 1920)) * sourceW;
        const sy = (crop.y / (master.sourceHeight || 1080)) * sourceH;
        const sw = (crop.width / (master.sourceWidth || 1920)) * sourceW;
        const sh = (crop.height / (master.sourceHeight || 1080)) * sourceH;

        ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

        const frame = new VideoFrame(canvas, { timestamp: frameCount * frameDuration });
        if (videoEncoder.state === 'configured') {
          videoEncoder.encode(frame, { keyFrame: frameCount % (fps * 2) === 0 });
        }
        frame.close();
        frameCount++;

        if (frameCount % 10 === 0) {
          onProgress?.(Math.min(frameCount / totalFrames, 0.99));
        }
      }, frameIntervalMs);

      videoEl.onended = () => {
        clearInterval(intervalId);
        clearTimeout(encodeTimeout);
        resolve();
      };
    });

    onProgress?.(1);

    if (videoEncoder.state === 'configured') {
      await videoEncoder.flush();
    }
    if (audioEncoder && audioEncoder.state === 'configured') {
      await audioEncoder.flush();
    }

    muxer.finalize();

    const buffer = muxer.target.buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    if (scriptNode) {
      try { scriptNode.disconnect(); } catch {}
    }
    if (audioSrc) {
      try { audioSrc.disconnect(); } catch {}
    }
    if (audioCtx) {
      try { await audioCtx.close(); } catch {}
    }
    videoEl.src = '';
    videoEl.load();
    if (videoEl.parentNode) {
      videoEl.parentNode.removeChild(videoEl);
    }
  }
}
