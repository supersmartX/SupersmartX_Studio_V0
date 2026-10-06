import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

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

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});
