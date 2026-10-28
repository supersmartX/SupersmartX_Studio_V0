/** Development-only diagnostics. This stores metrics only, never media bytes. */
export interface RecordingDiagnosticEvent {
  name: string;
  at: string;
  monotonicMs: number | null;
  data: Record<string, unknown>;
}

export interface RecordingDiagnosticsApi {
  events: RecordingDiagnosticEvent[];
  clear: () => void;
  exportJson: () => string;
}

declare global {
  interface Window {
    __SXS_RECORDING_DIAGNOSTICS__?: RecordingDiagnosticsApi;
  }
}

const MAX_EVENTS = 3000;

export function recordingDiagnosticsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && typeof window !== 'undefined';
}

function getApi(): RecordingDiagnosticsApi | null {
  if (!recordingDiagnosticsEnabled()) return null;
  if (!window.__SXS_RECORDING_DIAGNOSTICS__) {
    const api: RecordingDiagnosticsApi = {
      events: [],
      clear() { api.events.length = 0; },
      exportJson() { return JSON.stringify(api.events, null, 2); },
    };
    window.__SXS_RECORDING_DIAGNOSTICS__ = api;
  }
  return window.__SXS_RECORDING_DIAGNOSTICS__;
}

export function recordRecordingDiagnostic(name: string, data: Record<string, unknown> = {}): void {
  try {
    const api = getApi();
    if (!api) return;
    const monotonicMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : null;
    api.events.push({ name, at: new Date().toISOString(), monotonicMs, data });
    if (api.events.length > MAX_EVENTS) api.events.splice(0, api.events.length - MAX_EVENTS);
  } catch {
    // Diagnostics must never affect capture or recovery behavior.
  }
}

export function serializeCaptureConstraints(value: MediaStreamConstraints): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return { unavailable: true };
  }
}

export async function readCaptureDeviceLabels(): Promise<Array<{ kind: string; label: string | null }>> {
  if (!recordingDiagnosticsEnabled() || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    return (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'videoinput' || device.kind === 'audioinput')
      .map(({ kind, label }) => ({ kind, label: label || null }));
  } catch {
    return [];
  }
}

export interface RecordedContainerDiagnostics {
  mimeType: string | null;
  duration: number | null;
  videoDuration: number | null;
  audioDuration: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  fileSize: number;
}

/** Uses container metadata only. Failure/unavailable metrics remain null. */
export async function inspectRecordedContainer(blob: Blob): Promise<RecordedContainerDiagnostics | null> {
  if (!recordingDiagnosticsEnabled()) return null;
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const [mimeType, videoTrack, audioTrack] = await Promise.all([
        input.getMimeType().catch(() => null),
        input.getPrimaryVideoTrack().catch(() => null),
        input.getPrimaryAudioTrack().catch(() => null),
      ]);
      const [duration, videoDuration, audioDuration, videoWidth, videoHeight, videoCodec, audioCodec] = await Promise.all([
        input.getDurationFromMetadata().catch(() => null),
        videoTrack?.getDurationFromMetadata().catch(() => null) ?? null,
        audioTrack?.getDurationFromMetadata().catch(() => null) ?? null,
        videoTrack?.getCodedWidth().catch(() => null) ?? null,
        videoTrack?.getCodedHeight().catch(() => null) ?? null,
        videoTrack?.getCodec().catch(() => null) ?? null,
        audioTrack?.getCodec().catch(() => null) ?? null,
      ]);
      return {
        mimeType,
        duration,
        videoDuration,
        audioDuration,
        videoWidth,
        videoHeight,
        videoCodec,
        audioCodec,
        fileSize: blob.size,
      };
    } finally {
      input.dispose();
    }
  } catch {
    return null;
  }
}
