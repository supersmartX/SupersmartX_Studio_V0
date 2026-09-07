'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { ExportConfig, ExportJob, CropConfig, PlatformId, MasterRecording } from '@/types';
import { PLATFORM_PRESETS } from '@/constants';

interface UseExportPipelineReturn {
  exportConfig: ExportConfig | null;
  exportJobs: ExportJob[];
  setExportConfig: (config: ExportConfig | null) => void;
  selectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }) => ExportConfig;
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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current.forEach((controller) => controller.abort());
      abortControllerRef.current.clear();
    };
  }, []);

  const selectPlatform = useCallback(
    (platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }): ExportConfig => {
      sourceDimensionsRef.current = { width: sourceWidth, height: sourceHeight };

      const clamp = (w: number, h: number) => {
        if (!maxResolution) return { width: w, height: h };
        if (w <= maxResolution.width && h <= maxResolution.height) return { width: w, height: h };
        const scale = Math.min(maxResolution.width / w, maxResolution.height / h);
        return { width: Math.round(w * scale), height: Math.round(h * scale) };
      };

      const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
      if (!preset) {
        const outW = sourceWidth;
        const outH = Math.round(sourceWidth / (16 / 9));
        const clamped = clamp(outW, outH);
        const config: ExportConfig = {
          platformId: 'custom',
          aspectRatio: '16:9',
          outputWidth: clamped.width,
          outputHeight: clamped.height,
          crop: getDefaultCrop(sourceWidth, sourceHeight, clamped.width, clamped.height),
        };
        setExportConfig(config);
        return config;
      }

      const clamped = clamp(preset.width, preset.height);
      const config: ExportConfig = {
        platformId,
        aspectRatio: preset.aspectRatio,
        outputWidth: clamped.width,
        outputHeight: clamped.height,
        crop: getDefaultCrop(sourceWidth, sourceHeight, clamped.width, clamped.height),
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
        status: 'pending',
        progress: 0,
      };

      setExportJobs((prev) => [...prev, job]);

      try {
        // 1. Create server job
        const createRes = await fetch('/api/export-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: exportConfig }),
          signal: abortController.signal,
        });

        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({ error: 'Failed' }));
          throw new Error(err.error || 'Failed to create export job');
        }

        const { serverJobId } = await createRes.json();

        // 2. Update status to encoding
        await fetch(`/api/export-jobs/${serverJobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'encoding' }),
          signal: abortController.signal,
        }).catch(() => {});

        setExportJobs((prev) => prev.map((j) =>
          j.id === jobId ? { ...j, status: 'encoding', serverJobId, progress: 0 } : j,
        ));

        // 3. Client-side WebCodecs encoding
        const resultBlob = await encodeExport(master, exportConfig, abortController.signal, (p) => {
          onProgress?.(p);
          // Report progress to server every 10%
          if (serverJobId && Math.round(p * 100) % 10 === 0) {
            fetch(`/api/export-jobs/${serverJobId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'encoding', progress: Math.round(p * 100) }),
            }).catch(() => {});
          }
        });

        if (!mountedRef.current) return job;

        if (resultBlob.size < 100) {
          const failedJob: ExportJob = { ...job, status: 'error', error: 'Empty file produced', serverJobId };
          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
          fetch(`/api/export-jobs/${serverJobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed', errorMessage: 'Empty file produced' }),
          }).catch(() => {});
          abortControllerRef.current.delete(jobId);
          return failedJob;
        }

        // 4. Upload with jobId
        setExportJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'uploading' } : j)));

        let exportId: string | undefined;
        let r2Key: string | undefined;

        try {
          const formData = new FormData();
          formData.append('file', resultBlob, 'export.mp4');
          formData.append('platformId', exportConfig.platformId);
          if (serverJobId) {
            formData.append('jobId', serverJobId);
          }

          const response = await fetch('/api/export-upload', {
            method: 'POST',
            body: formData,
            signal: abortController.signal,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(errorData.error || 'Cloud upload failed');
          }

          const data = await response.json();
          exportId = data.exportId;
          r2Key = data.r2Key;
        } catch (uploadError) {
          if (!mountedRef.current) return job;
          const failedJob: ExportJob = {
            ...job,
            status: 'error',
            error: uploadError instanceof Error ? uploadError.message : 'Upload failed',
            serverJobId,
          };
          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
          fetch(`/api/export-jobs/${serverJobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed', errorMessage: uploadError instanceof Error ? uploadError.message : 'Upload failed' }),
          }).catch(() => {});
          abortControllerRef.current.delete(jobId);
          return failedJob;
        }

        if (!mountedRef.current) return job;

        const previewUrl = URL.createObjectURL(resultBlob);

        const completedJob: ExportJob = {
          ...job,
          status: 'done',
          exportId,
          r2Key,
          previewUrl,
          resultBlob,
          serverJobId,
          progress: 100,
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

        if (mountedRef.current) {
          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
        }
        abortControllerRef.current.delete(jobId);

        return failedJob;
      }
    },
    [exportConfig],
  );

  const startBatchExport = useCallback(
    async (master: MasterRecording, configs: ExportConfig[], onProgress?: (batchIndex: number, progress: number) => void): Promise<ExportJob[]> => {
      const results: ExportJob[] = [];
      for (let i = 0; i < configs.length; i++) {
        if (!mountedRef.current) break;

        const config = configs[i];
        sourceDimensionsRef.current = { width: master.sourceWidth || 1920, height: master.sourceHeight || 1080 };
        setExportConfig(config);

        const jobId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const abortController = new AbortController();
        abortControllerRef.current.set(jobId, abortController);

        const job: ExportJob = { id: jobId, masterId: master.id, config, status: 'pending', progress: 0 };
        setExportJobs((prev) => [...prev, job]);

        try {
          // 1. Create server job
          const createRes = await fetch('/api/export-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config }),
            signal: abortController.signal,
          });

          let serverJobId: string | undefined;
          if (createRes.ok) {
            const data = await createRes.json();
            serverJobId = data.serverJobId;
          }

          // 2. Update status to encoding
          if (serverJobId) {
            await fetch(`/api/export-jobs/${serverJobId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'encoding' }),
              signal: abortController.signal,
            }).catch(() => {});
          }

          setExportJobs((prev) => prev.map((j) =>
            j.id === jobId ? { ...j, status: 'encoding', serverJobId, progress: 0 } : j,
          ));

          // 3. Client-side encoding
          const resultBlob = await encodeExport(master, config, abortController.signal, (p) => {
            onProgress?.(i, p);
            if (serverJobId && Math.round(p * 100) % 10 === 0) {
              fetch(`/api/export-jobs/${serverJobId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'encoding', progress: Math.round(p * 100) }),
              }).catch(() => {});
            }
          });

          if (!mountedRef.current) break;

          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'uploading' } : j)));

          let exportId: string | undefined;
          let r2Key: string | undefined;

          try {
            const formData = new FormData();
            formData.append('file', resultBlob, 'export.mp4');
            formData.append('platformId', config.platformId);
            if (serverJobId) {
              formData.append('jobId', serverJobId);
            }

            const response = await fetch('/api/export-upload', {
              method: 'POST',
              body: formData,
              signal: abortController.signal,
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
              throw new Error(errorData.error || 'Cloud upload failed');
            }

            const data = await response.json();
            exportId = data.exportId;
            r2Key = data.r2Key;
          } catch (uploadError) {
            if (!mountedRef.current) break;
            const failedJob: ExportJob = { ...job, status: 'error', error: uploadError instanceof Error ? uploadError.message : 'Cloud upload failed', serverJobId };
            setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
            results.push(failedJob);
            abortControllerRef.current.delete(jobId);
            continue;
          }

          if (!mountedRef.current) break;

          const previewUrl = URL.createObjectURL(resultBlob);
          const completedJob: ExportJob = { ...job, status: 'done', exportId, r2Key, previewUrl, resultBlob, serverJobId, progress: 100 };
          setExportJobs((prev) => prev.map((j) => (j.id === jobId ? completedJob : j)));
          results.push(completedJob);
        } catch (error) {
          const failedJob: ExportJob = { ...job, status: 'error', error: error instanceof Error ? error.message : 'Failed' };
          if (mountedRef.current) {
            setExportJobs((prev) => prev.map((j) => (j.id === jobId ? failedJob : j)));
          }
          results.push(failedJob);
        }
        abortControllerRef.current.delete(jobId);
      }
      return results;
    },
    [],
  );

  const cancelExport = useCallback((jobId: string) => {
    const controller = abortControllerRef.current.get(jobId);
    if (controller) {
      controller.abort();
      abortControllerRef.current.delete(jobId);
    }
    setExportJobs((prev) => {
      const job = prev.find(j => j.id === jobId);
      if (job) {
        if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
      }
      return prev.filter((j) => j.id !== jobId);
    });
  }, []);

  const clearJobs = useCallback(() => {
    abortControllerRef.current.forEach((controller) => controller.abort());
    abortControllerRef.current.clear();
    setExportJobs((prev) => {
      prev.forEach((job) => {
        if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
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
  let workletNode: AudioWorkletNode | null = null;
  let encoderError: Error | null = null;
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;

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

    videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        muxer.addVideoChunk(chunk, metadata);
      },
      error: (e) => {
        console.error('VideoEncoder error:', e);
        encoderError = e;
      },
    });
    videoEncoder.configure({
      codec: getAvcCodec(outputWidth, outputHeight),
      width: outputWidth,
      height: outputHeight,
      bitrate: 10_000_000,
      bitrateMode: 'constant',
    });

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

        await audioCtx.audioWorklet.addModule('/audio-encoder-processor.js');
        workletNode = new AudioWorkletNode(audioCtx, 'audio-encoder-processor');
        audioSrc.connect(workletNode);
        workletNode.connect(audioCtx.destination);

        let audioTimestamp = 0;
        workletNode.port.onmessage = (e) => {
          if (!audioEncoder || audioEncoder.state !== 'configured') return;
          const { left, right } = e.data;
          const samples = new Float32Array(left.length * 2);
          for (let i = 0; i < left.length; i++) {
            samples[i * 2] = left[i];
            samples[i * 2 + 1] = right[i];
          }
          const audioData = new AudioData({
            format: 'f32-planar',
            numberOfChannels: 2,
            numberOfFrames: left.length,
            sampleRate: 48000,
            timestamp: audioTimestamp,
            data: samples,
          });
          audioTimestamp += Math.round((left.length / 48000) * 1_000_000);
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

        if (!videoEncoder || videoEncoder.encodeQueueSize > maxQueueSize) {
          return;
        }

        const sx = (crop.x / (master.sourceWidth || 1920)) * sourceW;
        const sy = (crop.y / (master.sourceHeight || 1080)) * sourceH;
        const sw = (crop.width / (master.sourceWidth || 1920)) * sourceW;
        const sh = (crop.height / (master.sourceHeight || 1080)) * sourceH;

        ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

        const frame = new VideoFrame(canvas, { timestamp: frameCount * frameDuration });
        if (videoEncoder && videoEncoder.state === 'configured') {
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

    if (encoderError) {
      throw encoderError;
    }

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
    // Close encoders to release resources
    try { if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close(); } catch {}
    try { if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close(); } catch {}

    if (workletNode) {
      try { workletNode.disconnect(); } catch {}
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
