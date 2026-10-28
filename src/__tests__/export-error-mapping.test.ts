import { describe, it, expect } from 'vitest';
import { toExportErrorMessage } from '@/hooks/useExportPipeline';
import { isAuthFailureMessage, humanizeExportError } from '@/components/dialogs/ExportModal';

describe('toExportErrorMessage', () => {
  it('keeps cancellations silent', () => {
    expect(toExportErrorMessage(new DOMException('Aborted', 'AbortError'), true)).toBeUndefined();
    expect(toExportErrorMessage(new Error('boom'), true)).toBeUndefined();
  });

  it('maps fetch network failures to a connection message', () => {
    expect(toExportErrorMessage(new TypeError('Failed to fetch'), false))
      .toBe('Connection error. Check your connection and try again.');
    expect(toExportErrorMessage(new TypeError('Load failed'), false))
      .toBe('Connection error. Check your connection and try again.');
    expect(toExportErrorMessage(new TypeError('NetworkError when attempting to fetch resource.'), false))
      .toBe('Connection error. Check your connection and try again.');
  });

  it('does not mask engine bugs that happen to be TypeErrors', () => {
    const msg = 'Cannot read properties of null (reading \'colorSpace\')';
    expect(toExportErrorMessage(new TypeError(msg), false)).toBe(msg);
  });

  it('passes server error text through unchanged', () => {
    expect(toExportErrorMessage(new Error('Maximum 3 concurrent exports'), false))
      .toBe('Maximum 3 concurrent exports');
    expect(toExportErrorMessage(new Error('User not found'), false)).toBe('User not found');
  });

  it('falls back for non-Error throws', () => {
    expect(toExportErrorMessage('string boom', false)).toBe('Export failed');
    expect(toExportErrorMessage(undefined, false)).toBe('Export failed');
  });
});

describe('isAuthFailureMessage', () => {
  it('detects expired/revoked/rowless session messages', () => {
    expect(isAuthFailureMessage('Unauthorized')).toBe(true);
    expect(isAuthFailureMessage('User not found')).toBe(true);
    expect(isAuthFailureMessage('Your session expired. Sign in again.')).toBe(true);
  });

  it('does not match quota, concurrency, network, or generic failures', () => {
    expect(isAuthFailureMessage('Maximum 3 concurrent exports')).toBe(false);
    expect(isAuthFailureMessage('Failed to fetch')).toBe(false);
    expect(isAuthFailureMessage('Connection error. Check your connection and try again.')).toBe(false);
    expect(isAuthFailureMessage('Export failed. Please try again.')).toBe(false);
    expect(isAuthFailureMessage('')).toBe(false);
  });
});

describe('humanizeExportError', () => {
  // The last line of defence before a message reaches a toast. The pipeline
  // already humanises what it can (toExportErrorMessage), but a server string
  // or an encoder failure can still arrive here raw — and none of that is
  // actionable for the person who just wants their video.
  it('passes short, human-written sentences through untouched', () => {
    expect(humanizeExportError('Maximum 3 concurrent exports')).toBe('Maximum 3 concurrent exports');
    expect(humanizeExportError('Connection error. Check your connection and try again.'))
      .toBe('Connection error. Check your connection and try again.');
    expect(humanizeExportError('Export failed. Please try again.')).toBe('Export failed. Please try again.');
  });

  it('replaces technical strings with a plain sentence', () => {
    const generic = 'Export failed. Please try again, or pick a different format.';
    // Raw server / library detail the user cannot act on.
    expect(humanizeExportError('PrismaClientValidationError: Invalid `export` invocation')).toBe(generic);
    expect(humanizeExportError("Cannot read properties of null (reading 'duration')")).toBe(generic);
    expect(humanizeExportError('DOMException: The operation was aborted')).toBe(generic);
    // A stack line.
    expect(humanizeExportError('Error: boom\n    at encode (C:/app/encoder.js:42:11)')).toBe(generic);
  });

  it('replaces anything unreasonably long regardless of content', () => {
    const generic = 'Export failed. Please try again, or pick a different format.';
    expect(humanizeExportError('x'.repeat(121))).toBe(generic);
  });
});
