import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

export async function uploadRecording(
  key: string,
  blob: Blob,
  metadata: Record<string, string>
): Promise<void> {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');

  const bucket = process.env.R2_BUCKET_NAME!;
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
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');

  const bucket = process.env.R2_BUCKET_NAME!;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function deleteRecording(key: string): Promise<void> {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');

  const bucket = process.env.R2_BUCKET_NAME!;

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
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  const bucket = process.env.R2_BUCKET_NAME!;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
}

export async function headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  const bucket = process.env.R2_BUCKET_NAME!;
  try {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const result = await client.send(command);
    return { size: result.ContentLength || 0, contentType: result.ContentType };
  } catch (e: any) {
    if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return null;
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
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');

  const bucket = process.env.R2_BUCKET_NAME!;

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
