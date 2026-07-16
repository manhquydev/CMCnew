import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
} from '@aws-sdk/client-s3';
import { detectPhotoContentType, type SessionPhotoContentType } from './photo-store.js';

// Content-addressed gift-photo store — mirrors pdf-store.ts's real disk|s3 driver seam
// (photo-store.ts is disk-only; red-team F2 requires the same S3 durability as prod exercise
// PDFs for gift photos). Reuses the same S3_* env/bucket as pdf-store.ts; a `gift-photos/` key
// prefix keeps refs from colliding with other content-addressed stores in the same bucket.
const DRIVER = process.env.GIFT_PHOTO_STORE_DRIVER === 's3' ? 's3' : 'disk';

export const MAX_GIFT_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB cap (plan Session 2 edge-case decision).
const REF_PATTERN = /^[a-f0-9]{64}$/;

export class GiftPhotoStoreError extends Error {}
// Server misconfiguration (e.g. missing S3 env) — callers must surface this as a 500, not a
// client-facing 4xx, since it can leak infra details.
export class GiftPhotoStoreConfigError extends GiftPhotoStoreError {}

export type GiftPhotoContentType = SessionPhotoContentType;

function assertValidGiftPhoto(buf: Buffer): GiftPhotoContentType {
  if (buf.length === 0) throw new GiftPhotoStoreError('empty file');
  if (buf.length > MAX_GIFT_PHOTO_BYTES) throw new GiftPhotoStoreError('file too large');
  const contentType = detectPhotoContentType(buf);
  if (!contentType) throw new GiftPhotoStoreError('not a supported image');
  return contentType;
}

// ── Disk driver ─────────────────────────────────────────────────────────────────────────────
const STORE_DIR = process.env.GIFT_PHOTO_STORE_DIR ?? path.resolve(process.cwd(), '.data/gift-photos');

function refToFile(ref: string): string {
  // ref is a 64-char lowercase hex sha256 — reject anything else so it can't escape STORE_DIR.
  if (!REF_PATTERN.test(ref)) throw new GiftPhotoStoreError('invalid gift photo ref');
  return path.join(STORE_DIR, ref);
}

async function diskPut(ref: string, buf: Buffer): Promise<void> {
  const file = refToFile(ref);
  await mkdir(STORE_DIR, { recursive: true });
  try {
    await access(file, constants.F_OK); // already stored → dedup, skip write.
  } catch {
    await writeFile(file, buf);
  }
}

async function diskExists(ref: string): Promise<boolean> {
  try {
    await access(refToFile(ref), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function diskRead(ref: string): Promise<Buffer> {
  try {
    return await readFile(refToFile(ref));
  } catch {
    throw new GiftPhotoStoreError('gift photo not found');
  }
}

// ── S3/MinIO driver ─────────────────────────────────────────────────────────────────────────
let s3Client: S3Client | null = null;

function s3(): S3Client {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
  });
  return s3Client;
}

function s3Bucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new GiftPhotoStoreConfigError('S3_BUCKET is not configured');
  return bucket;
}

function refToKey(ref: string): string {
  if (!REF_PATTERN.test(ref)) throw new GiftPhotoStoreError('invalid gift photo ref');
  return `gift-photos/${ref}`;
}

async function s3Put(ref: string, buf: Buffer): Promise<void> {
  if (await s3Exists(ref)) return; // already stored → dedup, skip write.
  await s3().send(new PutObjectCommand({ Bucket: s3Bucket(), Key: refToKey(ref), Body: buf }));
}

async function s3Exists(ref: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: refToKey(ref) }));
    return true;
  } catch (e) {
    if (e instanceof NotFound) return false;
    // Normalize any not-found-shaped error (e.g. generic 404 from some S3-compatible servers)
    // to `false` rather than leaking a distinct error to the caller — keeps giftPhotoExists a clean bool.
    if (e && typeof e === 'object' && '$metadata' in e && (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw e;
  }
}

async function s3Read(ref: string): Promise<Buffer> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: refToKey(ref) }));
    const body = res.Body;
    if (!body) throw new GiftPhotoStoreError('gift photo not found');
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e instanceof GiftPhotoStoreError) throw e;
    throw new GiftPhotoStoreError('gift photo not found');
  }
}

// ── Public API (driver-agnostic) ───────────────────────────────────────────────────────────
/** Store a gift photo; returns its content-address ref (sha256 hex) + detected content type.
 * Idempotent: re-storing the same bytes dedups. */
export async function putGiftPhoto(buf: Buffer): Promise<{ ref: string; contentType: GiftPhotoContentType }> {
  const contentType = assertValidGiftPhoto(buf);
  const ref = createHash('sha256').update(buf).digest('hex');
  if (DRIVER === 's3') {
    await s3Put(ref, buf);
  } else {
    await diskPut(ref, buf);
  }
  return { ref, contentType };
}

export async function giftPhotoExists(ref: string): Promise<boolean> {
  return DRIVER === 's3' ? s3Exists(ref) : diskExists(ref);
}

export async function readGiftPhoto(ref: string): Promise<{ buffer: Buffer; contentType: GiftPhotoContentType }> {
  const buffer = DRIVER === 's3' ? await s3Read(ref) : await diskRead(ref);
  const contentType = detectPhotoContentType(buffer);
  if (!contentType) throw new GiftPhotoStoreError('gift photo not found');
  return { buffer, contentType };
}
