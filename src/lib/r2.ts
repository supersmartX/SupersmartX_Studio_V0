// @ts-nocheck — @aws-sdk packages need `npm install` first
// Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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

export function generateRecordingKey(
  userId: string,
  extension: string
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `recordings/${userId}/${timestamp}-${random}.${extension}`;
}
