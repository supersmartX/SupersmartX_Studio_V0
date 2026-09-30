/**
 * STATE 20 — a browser that cannot encode must be refused, not left hanging.
 *
 * The failure this guards against is a stall, not a crash: without a capability
 * check the job enters `encoding`, reports 0%, and never resolves, so the user
 * watches "Exporting... 0%" with no error and no escape. Refusing before the
 * job is announced is the only point at which this is still recoverable.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  UNSUPPORTED_BROWSER_MESSAGE,
  UnsupportedBrowserError,
  getExportSupport,
  assertExportSupported,
} from '@/lib/export/browser-support';
import { toExportErrorMessage } from '@/hooks/useExportPipeline';

const original = (globalThis as Record<string, unknown>).VideoEncoder;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

function setVideoEncoder(value: unknown) {
  if (value === undefined) delete (globalThis as Record<string, unknown>).VideoEncoder;
  else (globalThis as Record<string, unknown>).VideoEncoder = value;
}

/**
 * jsdom has no 2d context, so the canvas guard would otherwise short-circuit
 * every probe test and they would pass without ever reaching the encoder check
 * they claim to exercise.
 */
function stubCanvas() {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}) as unknown as CanvasRenderingContext2D) as never;
}

afterEach(() => {
  setVideoEncoder(original);
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  vi.restoreAllMocks();
  vi.doUnmock('mediabunny');
});

describe('STATE 20 export capability gate', () => {
  it('refuses immediately when WebCodecs is absent', () => {
    setVideoEncoder(undefined);
    const support = getExportSupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toBe('no-webcodecs');
  });

  it('refuses with the message the user is meant to read', async () => {
    setVideoEncoder(undefined);
    await expect(assertExportSupported(1920, 1080)).rejects.toBeInstanceOf(UnsupportedBrowserError);
    await expect(assertExportSupported(1920, 1080)).rejects.toThrow(UNSUPPORTED_BROWSER_MESSAGE);
  });

  it('names Chrome or Edge, and never leaks an engine error string', () => {
    expect(UNSUPPORTED_BROWSER_MESSAGE).toMatch(/Chrome or Edge/);
    // The whole point is a plain sentence instead of "Unsupported codec".
    expect(UNSUPPORTED_BROWSER_MESSAGE).not.toMatch(/codec|webcodecs|mediabunny|undefined/i);
  });

  it('fails closed when the capability probe cannot be trusted', async () => {
    stubCanvas();
    // WebCodecs present, but the encoder refuses the config (Safari ships
    // WebCodecs without a usable H.264 encoder). That is the browser that used
    // to reach Conversion.init and hang.
    setVideoEncoder(class {});
    vi.doMock('mediabunny', () => ({ canEncodeVideo: async () => false }));
    await expect(assertExportSupported(1920, 1080)).rejects.toBeInstanceOf(UnsupportedBrowserError);
  });

  it('treats a throwing probe as unsupported rather than as a pass', async () => {
    stubCanvas();
    setVideoEncoder(class {});
    vi.doMock('mediabunny', () => ({
      canEncodeVideo: async () => {
        throw new Error('probe exploded');
      },
    }));
    // A probe that cannot answer is not permission to start an export that may hang.
    await expect(assertExportSupported(1920, 1080)).rejects.toBeInstanceOf(UnsupportedBrowserError);
  });

  it('proceeds on a browser that can encode', async () => {
    stubCanvas();
    setVideoEncoder(class {});
    vi.doMock('mediabunny', () => ({ canEncodeVideo: async () => true }));
    await expect(assertExportSupported(1920, 1080)).resolves.toBeUndefined();
  });

  it('surfaces the friendly message through the export error path', () => {
    // The modal shows result.error verbatim, so the refusal must not be
    // swallowed or replaced by a generic "Export failed".
    expect(toExportErrorMessage(new UnsupportedBrowserError(), false)).toBe(UNSUPPORTED_BROWSER_MESSAGE);
  });
});

describe('STATE 20 the pipeline gates before it announces work', () => {
  it('checks support before creating a server export job', () => {
    // Read through fs so this asserts on shipped source. A guard placed after
    // the POST would still pass every behavioural test above while letting an
    // unsupported browser create a job, burn quota, and then stall.
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const source = readFileSync(join(process.cwd(), 'src', 'hooks', 'useExportPipeline.ts'), 'utf8');

    const start = source.indexOf('const startExport = useCallback');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('const startBatchExport'));

    const gate = body.indexOf('assertExportSupported(');
    const post = body.indexOf("fetch('/api/export-jobs'");
    const patch = body.indexOf("'encoding'");

    expect(gate, 'the capability check must exist in startExport').toBeGreaterThan(-1);
    expect(post, 'the server job POST must exist in startExport').toBeGreaterThan(-1);
    expect(gate, 'the capability check must precede the server job POST').toBeLessThan(post);
    expect(patch, 'the encoding transition must exist in startExport').toBeGreaterThan(-1);
    expect(gate, 'the capability check must precede the encoding transition').toBeLessThan(patch);
  });

  it('marks the refused job as error so Retry stays available', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const source = readFileSync(join(process.cwd(), 'src', 'hooks', 'useExportPipeline.ts'), 'utf8');

    const start = source.indexOf('const startExport = useCallback');
    const body = source.slice(start, source.indexOf('const startBatchExport'));
    const gateIdx = body.indexOf('assertExportSupported(');
    const catchIdx = body.indexOf('const failedJob', gateIdx);

    expect(gateIdx).toBeGreaterThan(-1);
    expect(catchIdx, 'the refusal path must set a terminal status').toBeGreaterThan(gateIdx);
    // A terminal 'error' is what lets the modal return to the platform step and
    // offer Retry; a job left in 'encoding' is the 0% hang.
    expect(body.slice(catchIdx, catchIdx + 300)).toMatch(/status:\s*'error'/);
  });
});
