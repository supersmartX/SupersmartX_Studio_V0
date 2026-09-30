/**
 * STATE 20 — fail closed when this browser cannot complete an export.
 *
 * The export stack is WebCodecs + Mediabunny + canvas. Where those are missing
 * or cannot encode H.264, `Conversion.init` either rejects with a low-level
 * message ("Unsupported codec", "Codec not supported on this browser") or never
 * settles at all. The second case is the one that matters: the job sits in
 * `encoding` at 0% with no error to surface, so the user is left staring at
 * "Exporting... 0%" indefinitely and Retry is the only escape.
 *
 * The check therefore has to happen BEFORE the job is announced as started, not
 * after the encode has already wedged. A browser that cannot encode is told so
 * immediately, in plain words, and pointed at Chrome or Edge.
 */

export const UNSUPPORTED_BROWSER_MESSAGE =
  "Your browser can't complete this export. Please try Chrome or Edge.";

export interface ExportSupport {
  supported: boolean;
  /** Present only when unsupported, for logging. Never shown raw to the user. */
  reason?: 'no-webcodecs' | 'no-avc-encoder' | 'no-canvas';
}

export class UnsupportedBrowserError extends Error {
  constructor() {
    super(UNSUPPORTED_BROWSER_MESSAGE);
    this.name = 'UnsupportedBrowserError';
  }
}

/**
 * Whether this browser can actually run the export, checked before any work
 * begins. Synchronous and cheap on purpose: it is called on the click.
 */
export function getExportSupport(): ExportSupport {
  if (typeof globalThis.VideoEncoder === 'undefined') {
    return { supported: false, reason: 'no-webcodecs' };
  }
  if (typeof document === 'undefined') {
    return { supported: false, reason: 'no-canvas' };
  }
  try {
    if (!document.createElement('canvas').getContext('2d')) {
      return { supported: false, reason: 'no-canvas' };
    }
  } catch {
    return { supported: false, reason: 'no-canvas' };
  }
  return { supported: true };
}

/**
 * Async confirmation from the encoder itself.
 *
 * Presence of `VideoEncoder` is necessary but not sufficient: Safari ships
 * WebCodecs while historically lacking a hardware or software H.264 *encoder*,
 * which is precisely the browser that reaches `Conversion.init` and then
 * stalls. So ask the encoder whether it will accept the config we are about to
 * use, at the size we are about to use.
 *
 * Any error thrown while asking is treated as "cannot confirm", which resolves
 * to the friendly message rather than a wedged progress bar.
 */
export async function assertExportSupported(
  width: number,
  height: number
): Promise<void> {
  const support = getExportSupport();
  if (!support.supported) throw new UnsupportedBrowserError();

  try {
    const { canEncodeVideo } = await import('mediabunny');
    const ok = await canEncodeVideo('avc', { width, height });
    if (!ok) throw new UnsupportedBrowserError();
  } catch (error) {
    if (error instanceof UnsupportedBrowserError) throw error;
    // A probe that cannot run is not a licence to start an export that may hang.
    throw new UnsupportedBrowserError();
  }
}
