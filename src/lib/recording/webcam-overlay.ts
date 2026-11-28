import type { WebcamOverlaySettings, WebcamShape } from '@/types';

/**
 * Screen + webcam composition math (Loom-style floating webcam).
 *
 * All placement is expressed in NORMALIZED canvas coordinates so the layout is
 * resolution-independent: `x`/`y` locate the overlay CENTER within the canvas
 * (0..1) and `scale` is the overlay height as a fraction of the canvas height.
 * The pixel rect is derived from these at draw time AND at interaction time
 * from the exact same functions, so the draggable preview frame and the
 * composited recording frame can never disagree.
 */

/** Overlay height as a fraction of canvas height — clamp range. */
export const WEBCAM_SCALE_MIN = 0.12;
export const WEBCAM_SCALE_MAX = 0.45;
/** Keep-out margin between the overlay and the canvas edges (fraction). */
export const WEBCAM_EDGE_MARGIN = 0.02;

/** Assumed camera aspect when no track geometry is known yet. */
export const FALLBACK_CAMERA_ASPECT = 16 / 9;
export const FALLBACK_CANVAS_WIDTH = 1280;
export const FALLBACK_CANVAS_HEIGHT = 720;

export const DEFAULT_WEBCAM_OVERLAY: WebcamOverlaySettings = {
  visible: true,
  x: 0.5,
  y: 0.5,
  scale: 0.22,
  shape: 'rounded',
  mirrored: true,
  deviceId: '',
};

export type WebcamCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Repair anything a stale/persisted payload might contain. */
export function sanitizeWebcamOverlay(raw: unknown): WebcamOverlaySettings {
  const source = (raw ?? {}) as Partial<WebcamOverlaySettings>;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    visible: typeof source.visible === 'boolean' ? source.visible : DEFAULT_WEBCAM_OVERLAY.visible,
    x: num(source.x, DEFAULT_WEBCAM_OVERLAY.x),
    y: num(source.y, DEFAULT_WEBCAM_OVERLAY.y),
    scale: clampScale(num(source.scale, DEFAULT_WEBCAM_OVERLAY.scale)),
    shape: source.shape === 'circle' || source.shape === 'rounded' ? source.shape : DEFAULT_WEBCAM_OVERLAY.shape,
    mirrored: typeof source.mirrored === 'boolean' ? source.mirrored : DEFAULT_WEBCAM_OVERLAY.mirrored,
    deviceId: typeof source.deviceId === 'string' ? source.deviceId : '',
  };
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_WEBCAM_OVERLAY.scale;
  return Math.min(WEBCAM_SCALE_MAX, Math.max(WEBCAM_SCALE_MIN, scale));
}

/**
 * Overlay size in NORMALIZED canvas units. `cameraAspect` is the camera
 * frame's width/height; a circle overlay is square in PIXELS, which makes its
 * normalized width depend on the canvas aspect.
 */
export function webcamNormalizedSize(
  scale: number,
  shape: WebcamShape,
  cameraAspect: number,
  canvasAspect: number,
): { w: number; h: number } {
  const safeCanvasAspect = Number.isFinite(canvasAspect) && canvasAspect > 0 ? canvasAspect : 16 / 9;
  const safeCameraAspect = Number.isFinite(cameraAspect) && cameraAspect > 0 ? cameraAspect : FALLBACK_CAMERA_ASPECT;
  const h = scale;
  const pixelW = shape === 'circle' ? h : h * safeCameraAspect;
  // normalized width = pixel width / canvas width; canvas height = canvas width / canvasAspect
  const w = pixelW / safeCanvasAspect;
  return { w, h };
}

/**
 * Clamp an overlay CENTER (normalized) so the whole overlay rectangle stays
 * inside the canvas, honoring the edge margin.
 */
export function clampOverlayCenter(
  x: number,
  y: number,
  scale: number,
  shape: WebcamShape,
  cameraAspect: number,
  canvasAspect: number,
): { x: number; y: number } {
  const { w, h } = webcamNormalizedSize(scale, shape, cameraAspect, canvasAspect);
  const marginX = WEBCAM_EDGE_MARGIN * (1 / (canvasAspect || 16 / 9));
  const marginY = WEBCAM_EDGE_MARGIN;
  const halfW = w / 2;
  const halfH = h / 2;
  const minX = Math.max(halfW, marginX);
  const maxX = Math.min(1 - halfW, 1 - marginX);
  const minY = Math.max(halfH, marginY);
  const maxY = Math.min(1 - halfH, 1 - marginY);
  // Degenerate canvas (overlay bigger than canvas): keep centered.
  const cx = minX > maxX ? 0.5 : Math.min(maxX, Math.max(minX, x));
  const cy = minY > maxY ? 0.5 : Math.min(maxY, Math.max(minY, y));
  return { x: cx, y: cy };
}

export interface WebcamPixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The overlay rectangle in canvas PIXELS, fully clamped inside the canvas.
 * This is the single source of truth for both the compositor's draw pass and
 * the preview's interaction layer.
 */
export function computeWebcamRect(
  canvasWidth: number,
  canvasHeight: number,
  settings: WebcamOverlaySettings,
  cameraAspect: number,
): WebcamPixelRect {
  const clamped = clampOverlayCenter(
    settings.x,
    settings.y,
    clampScale(settings.scale),
    settings.shape,
    cameraAspect,
    canvasWidth / canvasHeight,
  );
  const h = clampScale(settings.scale) * canvasHeight;
  const w = settings.shape === 'circle' ? h : h * (Number.isFinite(cameraAspect) && cameraAspect > 0 ? cameraAspect : FALLBACK_CAMERA_ASPECT);
  return {
    x: clamped.x * canvasWidth - w / 2,
    y: clamped.y * canvasHeight - h / 2,
    w,
    h,
  };
}

/** Center (normalized) for a corner preset with the standard edge margin. */
export function cornerOverlayPosition(
  corner: WebcamCorner,
  scale: number,
  shape: WebcamShape,
  cameraAspect: number,
  canvasAspect: number,
): { x: number; y: number } {
  const { w, h } = webcamNormalizedSize(clampScale(scale), shape, cameraAspect, canvasAspect);
  const marginX = WEBCAM_EDGE_MARGIN * (1 / (canvasAspect || 16 / 9)) + w / 2;
  const marginY = WEBCAM_EDGE_MARGIN + h / 2;
  const x = corner.endsWith('left') ? marginX : 1 - marginX;
  const y = corner.startsWith('top') ? marginY : 1 - marginY;
  return clampOverlayCenter(x, y, scale, shape, cameraAspect, canvasAspect);
}

/**
 * Fit a content aspect inside a box (CSS "contain"), returning the pixel
 * offset and size of the content rect within the box. Used to letterbox the
 * composited canvas inside the preview box so the DOM overlay aligned to the
 * canvas matches the recorded composition exactly.
 */
export function fitContainRect(
  boxWidth: number,
  boxHeight: number,
  contentAspect: number,
): WebcamPixelRect {
  const safeBoxW = Math.max(0, boxWidth);
  const safeBoxH = Math.max(0, boxHeight);
  const aspect = Number.isFinite(contentAspect) && contentAspect > 0 ? contentAspect : 16 / 9;
  let width = safeBoxW;
  let height = width / aspect;
  if (height > safeBoxH) {
    height = safeBoxH;
    width = height * aspect;
  }
  return {
    x: (safeBoxW - width) / 2,
    y: (safeBoxH - height) / 2,
    w: width,
    h: height,
  };
}

function pathRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Draw `video` into the target rect with cover cropping (no distortion). */
export function drawVideoCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    ctx.drawImage(video, dx, dy, dw, dh);
    return;
  }
  const targetAspect = dw / dh;
  const sourceAspect = vw / vh;
  let sw = vw;
  let sh = vh;
  if (sourceAspect > targetAspect) {
    sw = vh * targetAspect;
  } else {
    sh = vw / targetAspect;
  }
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

export interface WebcamLayerOptions {
  shape: WebcamShape;
  mirrored: boolean;
}

/**
 * Draw the camera layer into `rect`, clipped to the configured shape. The
 * caller has already decided visibility — this only paints.
 */
export function drawWebcamLayer(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  rect: WebcamPixelRect,
  options: WebcamLayerOptions,
): void {
  ctx.save();
  ctx.beginPath();
  if (options.shape === 'circle') {
    const radius = Math.min(rect.w, rect.h) / 2;
    ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, radius, 0, Math.PI * 2);
  } else {
    pathRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h * 0.18);
  }
  ctx.clip();
  if (options.mirrored) {
    ctx.translate(rect.x * 2 + rect.w, 0);
    ctx.scale(-1, 1);
  }
  drawVideoCover(ctx, video, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/**
 * One composited frame: screen full-bleed, then the webcam overlay when it is
 * configured visible. Drawing the mirror by flipping AROUND the rect keeps the
 * mirrored preview identical to what MediaRecorder captures.
 */
export function drawComposedFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  screenVideo: HTMLVideoElement | null,
  cameraVideo: HTMLVideoElement | null,
  settings: WebcamOverlaySettings,
  cameraAspect: number,
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  if (screenVideo && screenVideo.readyState >= 2) {
    drawVideoCover(ctx, screenVideo, 0, 0, canvasWidth, canvasHeight);
  }
  if (!settings.visible || !cameraVideo || cameraVideo.readyState < 2) return;
  const rect = computeWebcamRect(canvasWidth, canvasHeight, settings, cameraAspect);
  drawWebcamLayer(ctx, cameraVideo, rect, { shape: settings.shape, mirrored: settings.mirrored });
}
