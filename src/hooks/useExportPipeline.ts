'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ExportConfig, ExportJob, CropConfig, PlatformId, MasterRecording } from '@/types';
import { saveLocalExport } from '@/lib/local-exports-store';
import { createExportConfig, getDefaultCrop } from '@/lib/export/export-config';
import { encodeExport } from '@/lib/export/export-engine';
import { uploadCreatorExportToR2 } from '@/lib/export/export-upload';
import { generateExportThumbnail } from '@/lib/export/export-thumbnail';

export { drawWatermark } from '@/lib/export/export-watermark';

function newJobId(): string {
  const rand = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 8);
  return `export-${Date.now()}-${rand}`;
}

// Terminal server-job reporting uses a FRESH signal: the export's own
// AbortController is already aborted (or aborting) on these paths, so reusing
// it would kill the PATCH before it lands and leak another stuck job.
function reportServerJob(serverJobId: string | undefined, body: { status: 'failed'; errorMessage?: string }): void {
  if (!serverJobId) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch(`/api/export-jobs/${serverJobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => {}).finally(() => clearTimeout(timeout));
  } catch {}
}

// fetch() network failures reject with TypeError (Chromium 'Failed to fetch',
// Safari 'Load failed', Firefox 'NetworkError...'). Map only that signature to
// a connection message — engine bugs (e.g. null dereferences, also TypeErrors)
// must keep their original text. Returns undefined for cancellations so the
// caller can keep them silent.
export function toExportErrorMessage(error: unknown, aborted: boolean): string | undefined {
  if (aborted) return undefined;
  if (error instanceof TypeError && /^(Failed to fetch|Load failed|NetworkError)/.test(error.message)) {
    return 'Connection error. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : 'Export failed';
}

interface UseExportPipelineReturn {
  exportConfig: ExportConfig | null;
  exportJobs: ExportJob[];
  setExportConfig: (config: ExportConfig | null) => void;
  selectPlatform: (platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }) => ExportConfig;
  updateCrop: (updates: Partial<CropConfig>) => void;
  resetCrop: () => void;
  startExport: (master: MasterRecording, onProgress?: (progress: number) => void, watermarkRequired?: boolean) => Promise<ExportJob>;
  startBatchExport: (master: MasterRecording, configs: ExportConfig[], onProgress?: (batchIndex: number, progress: number) => void, watermarkRequired?: boolean) => Promise<ExportJob[]>;
  cancelExport: (jobId: string) => void;
  clearJobs: () => void;
  generateThumbnail: (master: MasterRecording, timeSeconds?: number) => Promise<string>;
}

export function useExportPipeline(): UseExportPipelineReturn {
  const [exportConfig, setExportConfig] = useState<ExportConfig | null>(null);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const abortControllerRef = useRef<Map<string, AbortController>>(new Map());
  const sourceDimensionsRef = useRef<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const mountedRef = useRef(true);
  const jobsRef = useRef<ExportJob[]>([]);

  useEffect(() => { jobsRef.current = exportJobs; }, [exportJobs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      jobsRef.current.forEach((job) => { if (job.serverJobId) reportServerJob(job.serverJobId, { status: 'failed', errorMessage: 'Export interrupted' }); });
      abortControllerRef.current.forEach((controller) => controller.abort());
      abortControllerRef.current.clear();
      jobsRef.current.forEach((job) => { if (job.previewUrl) URL.revokeObjectURL(job.previewUrl); });
    };
  }, []);

  const selectPlatform = useCallback((platformId: PlatformId, sourceWidth: number, sourceHeight: number, maxResolution?: { width: number; height: number }): ExportConfig => {
    sourceDimensionsRef.current = { width: sourceWidth, height: sourceHeight };
    const config = createExportConfig(platformId, sourceWidth, sourceHeight, maxResolution);
    setExportConfig(config);
    return config;
  }, []);

  const updateCrop = useCallback((updates: Partial<CropConfig>) => {
    setExportConfig((prev) => prev ? { ...prev, crop: { ...prev.crop, ...updates } } : prev);
  }, []);

  const resetCrop = useCallback(() => {
    setExportConfig((prev) => {
      if (!prev) return prev;
      const dimensions = sourceDimensionsRef.current;
      return { ...prev, crop: getDefaultCrop(dimensions.width, dimensions.height, prev.outputWidth, prev.outputHeight) };
    });
  }, []);

  const startExport = useCallback(async (master: MasterRecording, onProgress?: (progress: number) => void, watermarkRequired?: boolean): Promise<ExportJob> => {
    if (!exportConfig) throw new Error('No export config');
    const jobId = newJobId();
    const abortController = new AbortController();
    abortControllerRef.current.set(jobId, abortController);
    const job: ExportJob = { id: jobId, masterId: master.id, config: exportConfig, status: 'pending', progress: 0 };
    setExportJobs((prev) => [...prev, job]);

    let serverJobId: string | undefined;
    try {
      if (!watermarkRequired) {
        try {
          const response = await fetch('/api/export-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: exportConfig }), signal: abortController.signal });
          if (response.ok) { const data = await response.json(); if (typeof data.jobId === 'string' && data.jobId.length > 0) serverJobId = data.jobId; }
        } catch {}
      }
      if (serverJobId) await fetch(`/api/export-jobs/${serverJobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'encoding' }), signal: abortController.signal }).catch(() => {});
      setExportJobs((prev) => prev.map((item) => item.id === jobId ? { ...item, status: 'encoding', serverJobId, progress: 0 } : item));

      const resultBlob = await encodeExport({ master, config: exportConfig, signal: abortController.signal, watermarkRequired: watermarkRequired || false, onProgress: (progress) => {
        onProgress?.(progress);
        if (serverJobId && Math.round(progress * 100) % 10 === 0) fetch(`/api/export-jobs/${serverJobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'encoding', progress: Math.round(progress * 100) }), signal: abortController.signal }).catch(() => {});
      }});

      if (!mountedRef.current) { abortControllerRef.current.delete(jobId); return job; }
      if (resultBlob.size < 100) {
        const failedJob: ExportJob = { ...job, status: 'error', error: 'Empty file produced', serverJobId };
        setExportJobs((prev) => prev.map((item) => item.id === jobId ? failedJob : item));
        fetch(`/api/export-jobs/${serverJobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'failed', errorMessage: 'Empty file produced' }), signal: abortController.signal }).catch(() => {});
        abortControllerRef.current.delete(jobId);
        return failedJob;
      }
      setExportJobs((prev) => prev.map((item) => item.id === jobId ? { ...item, status: 'uploading' } : item));

      let exportId: string | undefined;
      let r2Key: string | undefined;
      if (watermarkRequired) {
        try { await saveLocalExport({ id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, blob: resultBlob, platform: exportConfig.platformId, outputWidth: exportConfig.outputWidth, outputHeight: exportConfig.outputHeight, fileSize: resultBlob.size }); } catch {}
      } else {
        const uploaded = await uploadCreatorExportToR2(resultBlob, exportConfig, master.duration, abortController.signal, serverJobId);
        exportId = uploaded.exportId;
        r2Key = uploaded.r2Key;
        if (uploaded.serverJobId) serverJobId = uploaded.serverJobId;
      }
      if (!mountedRef.current) { abortControllerRef.current.delete(jobId); return job; }
      const completedJob: ExportJob = { ...job, status: 'done', exportId, r2Key, previewUrl: URL.createObjectURL(resultBlob), resultBlob, serverJobId, progress: 100 };
      setExportJobs((prev) => prev.map((item) => item.id === jobId ? completedJob : item));
      abortControllerRef.current.delete(jobId);
      return completedJob;
    } catch (error) {
      const aborted = abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      reportServerJob(serverJobId, { status: 'failed', errorMessage: aborted ? 'Cancelled by user' : error instanceof Error ? error.message : 'Export failed' });
      const failedJob: ExportJob = { ...job, status: aborted ? 'pending' : 'error', error: toExportErrorMessage(error, aborted) };
      if (mountedRef.current) setExportJobs((prev) => prev.map((item) => item.id === jobId ? failedJob : item));
      abortControllerRef.current.delete(jobId);
      return failedJob;
    }
  }, [exportConfig]);

  const startBatchExport = useCallback(async (master: MasterRecording, configs: ExportConfig[], onProgress?: (batchIndex: number, progress: number) => void, watermarkRequired?: boolean): Promise<ExportJob[]> => {
    const results: ExportJob[] = [];
    for (let index = 0; index < configs.length; index++) {
      if (!mountedRef.current) break;
      const config = configs[index];
      sourceDimensionsRef.current = { width: master.sourceWidth || 1920, height: master.sourceHeight || 1080 };
      setExportConfig(config);
      const jobId = newJobId();
      const abortController = new AbortController();
      abortControllerRef.current.set(jobId, abortController);
      const job: ExportJob = { id: jobId, masterId: master.id, config, status: 'pending', progress: 0 };
      setExportJobs((prev) => [...prev, job]);
      let serverJobId: string | undefined;
      try {
        const createResponse = await fetch('/api/export-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }), signal: abortController.signal });
        if (createResponse.ok) { const data = await createResponse.json(); if (typeof data.jobId === 'string' && data.jobId.length > 0) serverJobId = data.jobId; }
        if (serverJobId) await fetch(`/api/export-jobs/${serverJobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'encoding' }), signal: abortController.signal }).catch(() => {});
        setExportJobs((prev) => prev.map((item) => item.id === jobId ? { ...item, status: 'encoding', serverJobId, progress: 0 } : item));
        const resultBlob = await encodeExport({ master, config, signal: abortController.signal, watermarkRequired: watermarkRequired || false, onProgress: (progress) => { onProgress?.(index, progress); if (serverJobId && Math.round(progress * 100) % 10 === 0) fetch(`/api/export-jobs/${serverJobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'encoding', progress: Math.round(progress * 100) }), signal: abortController.signal }).catch(() => {}); } });
        if (!mountedRef.current) break;
        setExportJobs((prev) => prev.map((item) => item.id === jobId ? { ...item, status: 'uploading' } : item));
        let exportId: string | undefined;
        let r2Key: string | undefined;
        if (watermarkRequired) {
          try { await saveLocalExport({ id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, blob: resultBlob, platform: config.platformId, outputWidth: config.outputWidth, outputHeight: config.outputHeight, fileSize: resultBlob.size }); } catch {}
        } else {
          const uploaded = await uploadCreatorExportToR2(resultBlob, config, master.duration, abortController.signal, serverJobId);
          exportId = uploaded.exportId; r2Key = uploaded.r2Key; if (uploaded.serverJobId) serverJobId = uploaded.serverJobId;
        }
        if (!mountedRef.current) break;
        const completedJob: ExportJob = { ...job, status: 'done', exportId, r2Key, previewUrl: URL.createObjectURL(resultBlob), resultBlob, serverJobId, progress: 100 };
        setExportJobs((prev) => prev.map((item) => item.id === jobId ? completedJob : item));
        results.push(completedJob);
      } catch (error) {
        reportServerJob(serverJobId, { status: 'failed', errorMessage: error instanceof Error ? error.message : 'Export failed' });
        const failedJob: ExportJob = { ...job, status: 'error', error: toExportErrorMessage(error, abortController.signal.aborted) ?? 'Failed' };
        if (mountedRef.current) setExportJobs((prev) => prev.map((item) => item.id === jobId ? failedJob : item));
        results.push(failedJob);
      } finally { abortControllerRef.current.delete(jobId); }
    }
    return results;
  }, []);

  const cancelExport = useCallback((jobId: string) => {
    const controller = abortControllerRef.current.get(jobId);
    if (controller) { controller.abort(); abortControllerRef.current.delete(jobId); }
    const job = jobsRef.current.find((item) => item.id === jobId);
    if (job?.serverJobId) reportServerJob(job.serverJobId, { status: 'failed', errorMessage: 'Cancelled by user' });
    setExportJobs((prev) => { const found = prev.find((item) => item.id === jobId); if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl); return prev.filter((item) => item.id !== jobId); });
  }, []);

  const clearJobs = useCallback(() => {
    jobsRef.current.forEach((job) => { if (job.serverJobId) reportServerJob(job.serverJobId, { status: 'failed', errorMessage: 'Cancelled by user' }); });
    abortControllerRef.current.forEach((controller) => controller.abort());
    abortControllerRef.current.clear();
    setExportJobs((prev) => { prev.forEach((job) => { if (job.previewUrl) URL.revokeObjectURL(job.previewUrl); }); return []; });
  }, []);

  const generateThumbnail = useCallback(generateExportThumbnail, []);

  return { exportConfig, exportJobs, setExportConfig, selectPlatform, updateCrop, resetCrop, startExport, startBatchExport, cancelExport, clearJobs, generateThumbnail };
}
