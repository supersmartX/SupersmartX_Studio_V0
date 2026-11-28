import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { LOOKS_PRODUCTION } from './helpers/test-database';

// Guard the whole run, not just the harness. The database-backed suites
// `TRUNCATE` every application table, and each of them gates itself on
// DATABASE_URL being set at all — so a shell that exported the value from
// `.env.local` would point all 23 of them at the deployed database. This check
// runs before any test body and is the only one that cannot be forgotten by a
// new suite.
//
// Fail closed: abort the run instead of quietly clearing the URL. Silently
// blanking it let the destructive suites "pass" by skipping, which hides the
// misconfiguration and leaves the guard untested. A developer who really wants
// to run the database suites points DATABASE_URL at a disposable database (or
// sets ALLOW_TEST_DB=1 for a deliberately throwaway host).
if (LOOKS_PRODUCTION) {
  throw new Error(
    'Refusing to run tests: DATABASE_URL points at a production-looking database. ' +
    'Point it at a disposable database or set ALLOW_TEST_DB=1 deliberately.',
  );
}

// jsdom implements Blob/File with slice/size/type but omits the async readers
// (arrayBuffer/text/stream) that browsers and Node's undici both provide.
// Phase 3 artifact verification reads real bytes via the standard
// `blob.arrayBuffer()` in production; without this polyfill every unit test
// that reaches a blob read would fail on the environment, not on the code.
// FileReader is the spec-defined reader jsdom does implement, so this is the
// same access path a browser would take.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error('Blob read failed'));
        reader.readAsArrayBuffer(this);
      });
    },
    writable: true,
    configurable: true,
  });
}

// jsdom omits ResizeObserver, which the platform chip row uses to keep its
// scroll cue honest while the container resizes. Same rule as the Blob
// polyfill above: the environment gap is filled here, not worked around in
// product code. The stub never fires callbacks — the row measures once on
// mount, so only the resize-triggered re-check is absent under jsdom.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom omits PointerEvent entirely, so fireEvent.pointerDown/Move/Up build
// generic Events without pointerId/clientX — the webcam overlay drag math
// would read NaN from every pointer event. This constructor mirrors the part
// of the spec the drag handlers rely on (MouseEvent geometry + pointerId).
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    public pointerId: number;
    public pointerType: string;
    public isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}

// jsdom has no MediaStream at all. The composition layer builds its output as
// `new MediaStream([canvasTrack, ...audioTracks])`; this minimal
// constructor-tracks-only stand-in matches the surface the recorder and the
// compositor read (getTracks/getVideoTracks/getAudioTracks). Streams in tests
// that only need to BE a MediaStream keep using object doubles.
if (typeof globalThis.MediaStream === 'undefined') {
  class MediaStreamStub {
    private tracks: MediaStreamTrack[];
    constructor(tracks?: MediaStreamTrack[] | MediaStreamTrack) {
      this.tracks = Array.isArray(tracks) ? [...tracks] : tracks ? [tracks] : [];
    }
    getTracks(): MediaStreamTrack[] {
      return [...this.tracks];
    }
    getVideoTracks(): MediaStreamTrack[] {
      return this.getTracks().filter((t) => t.kind === 'video');
    }
    getAudioTracks(): MediaStreamTrack[] {
      return this.getTracks().filter((t) => t.kind === 'audio');
    }
    addTrack(track: MediaStreamTrack): void {
      if (!this.tracks.includes(track)) this.tracks.push(track);
    }
    removeTrack(track: MediaStreamTrack): void {
      this.tracks = this.tracks.filter((t) => t !== track);
    }
    get id(): string {
      return 'stub-stream';
    }
    clone(): MediaStream {
      return new MediaStreamStub([...this.tracks]) as unknown as MediaStream;
    }
  }
  globalThis.MediaStream = MediaStreamStub as unknown as typeof MediaStream;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});
