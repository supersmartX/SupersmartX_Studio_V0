import { describe, it, expect } from 'vitest';
import { toExportErrorMessage } from '@/hooks/useExportPipeline';
import { isAuthFailureMessage } from '@/components/dialogs/ExportModal';

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
