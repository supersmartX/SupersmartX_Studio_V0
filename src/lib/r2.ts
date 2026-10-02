import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Cloudflare account IDs are exactly 32 hex characters. Anything else cannot
// address a real account, and the S3 endpoint it produces fails the TLS
// handshake at Cloudflare's edge (`sslv3 alert handshake failure`) — a
// signature mismatch never even gets that far. Rejecting the shape here is what
// turns "Connection error. Check your connection and try again." into a 503.
const R2_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;

// R2 bucket names: 3-63 chars, lowercase alphanumerics with internal dashes.
const R2_BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

// Values shipped in .env.example, DEPLOYMENT.md and audit/CHANGELOG.md as
// fill-in-the-blank. They are non-empty, so every truthiness check treats them
// as configured and the failure only surfaces as an opaque network error much
// later in the export pipeline.
const PLACEHOLDER_LITERALS = new Set([
  'your_account_id',
  'your-account-id',
  'your-cloudflare-account',
  'your-bucket-name',
  'your-access-key-id',
  'your-access-key',
  'your-secret-access-key',
  'your-secret-key',
  'placeholder',
  'changeme',
  'change-me',
  'replace-me',
  'replace_me',
  'todo',
  'tbd',
  'xxx',
]);

// Substring form, used only for the two credential values. A high-entropy key
// cannot contain these, whereas a bucket name legitimately can ("*-example-*"),
// so the bucket is matched against the exact set instead.
const PLACEHOLDER_SUBSTRING =
  /(your[_-]|xxx+|placeholder|changeme|change[_-]?me|replace[_-]?me|insert[_-]?here|dummy|example|todo|tbd|<[^>]*>|\$\{)/i;

function readConfigValue(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isUsableCredential(value: string | undefined): boolean {
  return !!value && !/\s/.test(value) && !PLACEHOLDER_SUBSTRING.test(value);
}

function isUsableBucketName(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  if (PLACEHOLDER_LITERALS.has(normalized)) return false;
  if (PLACEHOLDER_LITERALS.has(normalized.replace(/[_-]/g, ''))) return false;
  return true;
}

/**
 * Returns a short, human-readable reason R2 is unusable, or null when the
 * configuration is well-formed. Callers surface this instead of a generic
 * "Storage not configured" so a misconfigured environment is self-describing.
 */
export function getR2ConfigurationError(): string | null {
  const accountId = readConfigValue('R2_ACCOUNT_ID');
  if (!accountId) return 'R2_ACCOUNT_ID is not set';
  if (PLACEHOLDER_LITERALS.has(accountId.toLowerCase())) return 'R2_ACCOUNT_ID is still a placeholder value';
  if (!R2_ACCOUNT_ID_PATTERN.test(accountId)) return 'R2_ACCOUNT_ID must be a 32-character Cloudflare account ID';

  const accessKeyId = readConfigValue('R2_ACCESS_KEY_ID');
  if (!accessKeyId) return 'R2_ACCESS_KEY_ID is not set';
  if (!isUsableCredential(accessKeyId)) return 'R2_ACCESS_KEY_ID is not a usable credential';

  const secretAccessKey = readConfigValue('R2_SECRET_ACCESS_KEY');
  if (!secretAccessKey) return 'R2_SECRET_ACCESS_KEY is not set';
  if (!isUsableCredential(secretAccessKey)) return 'R2_SECRET_ACCESS_KEY is not a usable credential';

  const bucket = readConfigValue('R2_BUCKET_NAME');
  if (!bucket) return 'R2_BUCKET_NAME is not set';
  if (!isUsableBucketName(bucket)) return 'R2_BUCKET_NAME is still a placeholder value';
  if (!R2_BUCKET_NAME_PATTERN.test(bucket)) return 'R2_BUCKET_NAME is not a valid R2 bucket name';

  return null;
}

export function isR2Configured(): boolean {
  return getR2ConfigurationError() === null;
}

function getR2Client(): S3Client | null {
  const configError = getR2ConfigurationError();
  if (configError) return null;

  return new S3Client({
    region: 'auto',
    endpoint: `https://${readConfigValue('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    // R2 has no virtual-hosted-style endpoint. Since @aws-sdk/client-s3 v3.729
    // the SDK defaults this to false and would emit
    // https://<bucket>.<account>.r2.cloudflarestorage.com/... — a host that does
    // not exist, so every presigned URL 403s/handshake-fails at the browser.
    forcePathStyle: true,
    credentials: {
      accessKeyId: readConfigValue('R2_ACCESS_KEY_ID') as string,
      secretAccessKey: readConfigValue('R2_SECRET_ACCESS_KEY') as string,
    },
  });
}

function requireR2Client(): S3Client {
  const client = getR2Client();
  if (!client) throw new Error(`R2 not configured: ${getR2ConfigurationError()}`);
  return client;
}

function getBucketName(): string {
  const bucket = readConfigValue('R2_BUCKET_NAME');
  if (!bucket) throw new Error('R2_BUCKET_NAME is not configured');
  return bucket;
}

export async function uploadRecording(
  key: string,
  blob: Blob,
  metadata: Record<string, string>
): Promise<void> {
  const client = requireR2Client();

  const bucket = getBucketName();
  const arrayBuffer = await blob.arrayBuffer();
  const body = new Uint8Array(arrayBuffer);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: blob.type || 'video/webm',
    Metadata: metadata,
  });

  await client.send(command);
}

export async function getSignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = requireR2Client();

  const bucket = getBucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function deleteRecording(key: string): Promise<void> {
  const client = requireR2Client();

  const bucket = getBucketName();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);
}

export async function getSignedUploadUrl(
  key: string,
  contentType: string = 'video/mp4',
  expiresIn: number = 900
): Promise<string> {
  const client = requireR2Client();
  const bucket = getBucketName();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
}

export async function headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  const client = requireR2Client();
  const bucket = getBucketName();
  try {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const result = await client.send(command);
    return { size: result.ContentLength || 0, contentType: result.ContentType };
  } catch (e: unknown) {
    if (e instanceof Error && (e.name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
}

export function generateExportKey(userId: string): string {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `exports/${userId}/${uuid}.mp4`;
}

export async function listUserRecordings(
  prefix: string
): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  const client = requireR2Client();

  const bucket = getBucketName();

  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  });

  const response = await client.send(command);

  return (response.Contents || []).map((item) => ({
    key: item.Key || '',
    size: item.Size || 0,
    lastModified: item.LastModified || new Date(),
  }));
}

const ALLOWED_UPLOAD_EXTENSIONS = ['webm', 'mp4'];

export function generateRecordingKey(
  userId: string,
  extension: string
): string {
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension)) {
    throw new Error(`Invalid extension: ${extension}`);
  }
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `recordings/${userId}/${uuid}.${extension}`;
}
