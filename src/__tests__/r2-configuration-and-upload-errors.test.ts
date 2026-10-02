import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isR2Configured, getR2ConfigurationError, getSignedUploadUrl } from '@/lib/r2';
import { ExportUploadError, describeUploadError } from '@/lib/export/export-upload';
import { toExportErrorMessage } from '@/hooks/useExportPipeline';

const VALID = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'cd99176f5c9153c24f056ea0ecee2725',
  R2_SECRET_ACCESS_KEY: 'f'.repeat(64),
  R2_BUCKET_NAME: 'supersmartx-studio-exports',
};

const R2_ENV_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'] as const;

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of R2_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of R2_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('R2 configuration validation', () => {
  it('accepts a well-formed configuration', () => {
    Object.assign(process.env, VALID);
    expect(getR2ConfigurationError()).toBeNull();
    expect(isR2Configured()).toBe(true);
  });

  it('rejects the placeholder values shipped in the repo docs', () => {
    // These are exactly what .env.example / DEPLOYMENT.md tell you to fill in.
    // They are non-empty, so the previous truthiness check accepted them and the
    // failure only appeared much later as an opaque connection error.
    Object.assign(process.env, {
      ...VALID,
      R2_ACCOUNT_ID: 'your_account_id',
      R2_ACCESS_KEY_ID: 'YOUR_ACCESS_KEY',
      R2_SECRET_ACCESS_KEY: 'YOUR_SECRET_KEY',
      R2_BUCKET_NAME: 'your-bucket-name',
    });
    expect(isR2Configured()).toBe(false);
    expect(getR2ConfigurationError()).toBe('R2_ACCOUNT_ID is still a placeholder value');
  });

  it('rejects a non-hex, wrong-length account id', () => {
    // The value that actually broke production: 34 chars, non-hex characters.
    Object.assign(process.env, { ...VALID, R2_ACCOUNT_ID: '3H4ZCi9mhZsFpowmmVhUh1NF1C5NoSPPvH' });
    expect(isR2Configured()).toBe(false);
    expect(getR2ConfigurationError()).toBe('R2_ACCOUNT_ID must be a 32-character Cloudflare account ID');
  });

  it('rejects missing, empty and whitespace-only values', () => {
    expect(getR2ConfigurationError()).toBe('R2_ACCOUNT_ID is not set');

    Object.assign(process.env, { ...VALID, R2_ACCOUNT_ID: '   ' });
    expect(getR2ConfigurationError()).toBe('R2_ACCOUNT_ID is not set');

    Object.assign(process.env, VALID, { R2_SECRET_ACCESS_KEY: '' });
    expect(getR2ConfigurationError()).toBe('R2_SECRET_ACCESS_KEY is not set');
  });

  it('rejects an invalid bucket name', () => {
    Object.assign(process.env, { ...VALID, R2_BUCKET_NAME: 'Not_A_Bucket' });
    expect(getR2ConfigurationError()).toBe('R2_BUCKET_NAME is not a valid R2 bucket name');
  });

  it('does not reject a legitimate bucket that merely contains a placeholder word', () => {
    Object.assign(process.env, { ...VALID, R2_BUCKET_NAME: 'example-media-prod' });
    expect(isR2Configured()).toBe(true);
  });

  it('surfaces the reason from every R2 operation instead of "R2 not configured"', async () => {
    Object.assign(process.env, { ...VALID, R2_ACCOUNT_ID: 'your_account_id' });
    await expect(getSignedUploadUrl('exports/u/x.mp4')).rejects.toThrow(
      'R2 not configured: R2_ACCOUNT_ID is still a placeholder value',
    );
  });
});

describe('presigned URL addressing', () => {
  it('uses path-style addressing so the host actually exists', async () => {
    Object.assign(process.env, VALID);
    const url = new URL(await getSignedUploadUrl('exports/u/x.mp4'));

    // R2 has no virtual-hosted-style endpoint. @aws-sdk/client-s3 defaults
    // forcePathStyle to false from v3.729 onwards, which would produce
    // <bucket>.<account>.r2.cloudflarestorage.com — a host that does not exist.
    expect(url.host).toBe(`${VALID.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(url.pathname.startsWith(`/${VALID.R2_BUCKET_NAME}/`)).toBe(true);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});

describe('upload stage errors', () => {
  it('names the stage that broke instead of saying "connection error"', () => {
    const denied = new ExportUploadError('requesting upload URL', 'Rate limited', false);
    expect(toExportErrorMessage(denied, false)).toBe('R2 presigned URL generation failed: Rate limited');

    const rejected = new ExportUploadError('uploading to storage', 'storage rejected the upload (status 403)', false);
    expect(toExportErrorMessage(rejected, false)).toBe('R2 upload failed: storage rejected the upload (status 403)');

    const finalize = new ExportUploadError('finalizing export', 'Completion failed', false);
    expect(toExportErrorMessage(finalize, false)).toBe('R2 export completion failed: Completion failed');
  });

  it('still says "connection" for a genuine network failure, but names the stage', () => {
    const network = new ExportUploadError('uploading to storage', 'Failed to fetch', true);
    const message = toExportErrorMessage(network, false) as string;
    expect(message).toContain('Connection error');
    expect(message).toContain('the upload to R2 storage');
    expect(message).not.toBe('Connection error. Check your connection and try again.');
  });

  it('keeps cancellations silent and engine TypeErrors intact', () => {
    const network = new ExportUploadError('finalizing export', 'Load failed', true);
    expect(toExportErrorMessage(network, true)).toBeUndefined();
    expect(toExportErrorMessage(new TypeError("Cannot read properties of null (reading 'colorSpace')"), false))
      .toBe("Cannot read properties of null (reading 'colorSpace')");
  });

  it('exposes the phase wording used by describeUploadError', () => {
    expect(describeUploadError(new ExportUploadError('requesting upload URL', 'boom', false)))
      .toBe('R2 presigned URL generation failed: boom');
  });
});