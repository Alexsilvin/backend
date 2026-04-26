import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client: S3Client | null = null;

/**
 * Get or create S3 client
 */
export function getS3Client(): S3Client {
  if (!s3Client) {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 configuration missing: S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
    }

    s3Client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
  }

  return s3Client;
}

/**
 * Get bucket name
 */
export function getBucketName(): string | null {
  return (
    process.env.S3_BUCKET ||
    process.env.FILEBASE_BUCKET ||
    process.env.S3_BUCKET_NAME ||
    process.env.FILEBASE_BUCKET_NAME ||
    null
  );
}

/**
 * Check if S3 is configured
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    getBucketName()
  );
}

/**
 * Create signed PUT URL for uploading
 */
export async function createSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds: number
): Promise<string> {
  const bucket = getBucketName();
  if (!bucket) {
    throw new Error('S3 bucket not configured');
  }

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, {
    expiresIn: Math.min(Math.max(expiresInSeconds, 60), 900),
  });
}

/**
 * Create signed GET URL for downloading
 */
export async function createSignedDownloadUrl(
  key: string,
  filename: string,
  expiresInSeconds: number
): Promise<string> {
  const bucket = getBucketName();
  if (!bucket) {
    throw new Error('S3 bucket not configured');
  }

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  return getSignedUrl(client, command, {
    expiresIn: Math.min(Math.max(expiresInSeconds, 30), 300),
  });
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'file.bin';
}

/**
 * Normalize license type
 */
export function normalizeLicenseType(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : 'unknown';
  return text.slice(0, 40) || 'unknown';
}
