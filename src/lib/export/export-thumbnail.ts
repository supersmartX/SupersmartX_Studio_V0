import type { MasterRecording } from '@/types';
import { getCanvasContext } from './frame-builder';

export async function generateExportThumbnail(master: MasterRecording, timeSeconds = 1): Promise<string> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  document.body.appendChild(video);
  const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Thumbnail load timeout')), 10000); video.onloadeddata = () => { clearTimeout(timeout); resolve(); }; video.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load video for thumbnail')); }; video.src = master.url; });
    video.currentTime = Math.min(timeSeconds, video.duration || 1);
    await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Thumbnail seek timeout')), 8000); video.onseeked = () => { clearTimeout(timeout); resolve(); }; video.onerror = () => { clearTimeout(timeout); reject(new Error('Seek failed')); }; });
    const width = 320;
    const height = Math.round((video.videoHeight / video.videoWidth) * width) || 180;
    canvas.width = width;
    canvas.height = height;
    const ctx = getCanvasContext(canvas);
    if (!ctx) throw new Error('Canvas context not available');
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } finally {
    try { const ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); } catch {}
    canvas.width = 0; canvas.height = 0; video.src = ''; video.load(); if (video.parentNode) video.parentNode.removeChild(video);
  }
}
