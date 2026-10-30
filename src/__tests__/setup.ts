import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { LOOKS_PRODUCTION } from './helpers/test-database';

// Guard the whole run, not just the harness. The database-backed suites
// `TRUNCATE` every application table, and each of them gates itself on
// DATABASE_URL being set at all — so a shell that exported the value from
// `.env.local` would point all 23 of them at the deployed database. This check
// runs before any test body and is the only one that cannot be forgotten by a
// new suite.
if (LOOKS_PRODUCTION) {
  throw new Error(
    'Refusing to run tests: DATABASE_URL looks like the deployed database. ' +
      'Unset DATABASE_URL (the database-backed suites then report as skipped) ' +
      'or point it at a throwaway database. To override deliberately, set ALLOW_TEST_DB=1.',
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

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});
