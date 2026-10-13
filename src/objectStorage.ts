import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';

const maxDocumentSize = 20 * 1024 * 1024;
const uploadUrlLifetimeSeconds = 10 * 60;
const downloadUrlLifetimeSeconds = 10 * 60;

const getBucket = () => {
  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET) {
    throw new HttpError(503, 'Shared document storage is not configured');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY
    }
  });
  return { client, bucket: config.R2_BUCKET };
};

export const validateDocumentSize = (size: number) => {
  if (size < 1 || size > maxDocumentSize) {
    throw new HttpError(400, 'Documents must be between 1 byte and 20 MB');
  }
};

export const createDocumentUpload = async (mimeType: string, size: number) => {
  validateDocumentSize(size);
  const { client, bucket } = getBucket();
  const storageKey = `pending/${randomUUID()}`;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ContentType: mimeType,
    ContentLength: size
  });
  return {
    storageKey,
    uploadUrl: await getSignedUrl(client, command, { expiresIn: uploadUrlLifetimeSeconds })
  };
};

export const confirmDocumentUpload = async (storageKey: string, expectedSize: number, mimeType: string) => {
  const { client, bucket } = getBucket();
  let head;
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey }));
  } catch (error) {
    if (error instanceof Error && ['NotFound', 'NoSuchKey', 'NoSuchObject'].includes(error.name)) {
      throw new HttpError(400, 'The document upload was not found');
    }
    throw error;
  }
  if (head.ContentLength !== expectedSize || head.ContentType !== mimeType) {
    throw new HttpError(400, 'Uploaded document size or type does not match the request');
  }

  const finalKey = `documents/${randomUUID()}`;
  const copySource = `${bucket}/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: finalKey,
    CopySource: copySource,
    MetadataDirective: 'COPY'
  }));
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
  return finalKey;
};

export const deleteStoredObject = async (storageKey: string) => {
  const { client, bucket } = getBucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
};

export const createDocumentDownloadUrl = async (storageKey: string, fileName: string, mimeType: string) => {
  const { client, bucket } = getBucket();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ResponseContentType: mimeType,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
  });
  return getSignedUrl(client, command, { expiresIn: downloadUrlLifetimeSeconds });
};
