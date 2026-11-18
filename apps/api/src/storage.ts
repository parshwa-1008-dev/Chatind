import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import path from "node:path";
import { config } from "./config";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "audio/webm", "audio/mpeg", "application/pdf"]);

export function validateFileBytes(contentType: string, bytes: Uint8Array): void {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const ascii = (start: number, length: number) => Buffer.from(bytes.slice(start, start + length)).toString("ascii");
  const valid = contentType === "image/jpeg" ? startsWith(0xff, 0xd8, 0xff)
    : contentType === "image/png" ? startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : contentType === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP"
    : contentType === "video/mp4" ? ascii(4, 4) === "ftyp"
    : contentType === "audio/webm" ? startsWith(0x1a, 0x45, 0xdf, 0xa3)
    : contentType === "audio/mpeg" ? ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] || 0) & 0xe0) === 0xe0)
    : contentType === "application/pdf" ? ascii(0, 5) === "%PDF-"
    : false;
  if (!valid) throw new Error("File content does not match the declared type");
}

function createStorageClient(): S3Client {
  return new S3Client({
    region: config.STORAGE_REGION,
    endpoint: config.STORAGE_ENDPOINT || undefined,
    forcePathStyle: Boolean(config.STORAGE_ENDPOINT),
    credentials: { accessKeyId: config.STORAGE_ACCESS_KEY, secretAccessKey: config.STORAGE_SECRET_KEY },
  });
}

export async function storeUpload(file: Express.Multer.File): Promise<{ key: string; url: string }> {
  if (!allowedTypes.has(file.mimetype)) throw new Error("Unsupported attachment type");
  if (file.size > config.MAX_UPLOAD_BYTES) throw new Error("Attachment exceeds the upload limit");
  validateFileBytes(file.mimetype, file.buffer);
  if (!config.STORAGE_BUCKET || !config.STORAGE_ACCESS_KEY || !config.STORAGE_SECRET_KEY) {
    throw new Error("Object storage is not configured");
  }
  const extension = path.extname(file.originalname).toLowerCase().slice(0, 12);
  const key = `${crypto.randomUUID()}${extension}`;
  const client = createStorageClient();
  await client.send(new PutObjectCommand({
    Bucket: config.STORAGE_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ContentLength: file.size,
  }));
  const url = await createDownloadUrl(key);
  return { key, url };
}

export async function createDownloadUrl(key: string): Promise<string> {
  if (config.STORAGE_PUBLIC_URL) return `${config.STORAGE_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  const client = createStorageClient();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }), { expiresIn: 3600 });
}

export async function removeUpload(key: string): Promise<void> {
  await createStorageClient().send(new DeleteObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }));
}
