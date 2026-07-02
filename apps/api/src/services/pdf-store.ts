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

// Content-addressed PDF store. The exercise base PDF is stored ONCE under its sha256
// (spec §3 dedup) — identical uploads collapse to one object/file. `PDF_STORE_DRIVER`
// (disk|s3) selects the persistence backend behind the same `putPdf`/`pdfExists`/`readPdf`
// seam; callers and the `basePdfRef` content hash are unaffected by the driver.
const DRIVER = process.env.PDF_STORE_DRIVER === 's3' ? 's3' : 'disk';

// Guard the input: cap size and require the %PDF magic so the store only ever holds PDFs.
export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB — bound input bloat at the door (spec §3).
const PDF_MAGIC = Buffer.from('%PDF-');
const REF_PATTERN = /^[a-f0-9]{64}$/;

export class PdfStoreError extends Error {}
// Server misconfiguration (e.g. missing S3 env), never an input-validation problem — callers
// must not echo this message to the client as a 4xx, since it can leak infra details.
export class PdfStoreConfigError extends PdfStoreError {}

function assertValidPdf(buf: Buffer): void {
  if (buf.length === 0) throw new PdfStoreError('empty file');
  if (buf.length > MAX_PDF_BYTES) throw new PdfStoreError('file too large');
  if (!buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw new PdfStoreError('not a PDF');
}

// ── Disk driver ─────────────────────────────────────────────────────────────────────────────
const STORE_DIR = process.env.PDF_STORE_DIR ?? path.resolve(process.cwd(), '.data/pdf');

function refToFile(ref: string): string {
  // ref is a 64-char lowercase hex sha256 — reject anything else so it can't escape STORE_DIR.
  if (!REF_PATTERN.test(ref)) throw new PdfStoreError('invalid pdf ref');
  return path.join(STORE_DIR, `${ref}.pdf`);
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
    throw new PdfStoreError('pdf not found');
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
  if (!bucket) throw new PdfStoreConfigError('S3_BUCKET is not configured');
  return bucket;
}

function refToKey(ref: string): string {
  if (!REF_PATTERN.test(ref)) throw new PdfStoreError('invalid pdf ref');
  return `${ref}.pdf`;
}

async function s3Put(ref: string, buf: Buffer): Promise<void> {
  if (await s3Exists(ref)) return; // already stored → dedup, skip write.
  await s3().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: refToKey(ref),
      Body: buf,
      ContentType: 'application/pdf',
    }),
  );
}

async function s3Exists(ref: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: refToKey(ref) }));
    return true;
  } catch (e) {
    if (e instanceof NotFound) return false;
    // Normalize any not-found-shaped error (e.g. generic 404 from some S3-compatible servers)
    // to `false` rather than leaking a distinct error to the caller — keeps pdfExists a clean bool.
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
    if (!body) throw new PdfStoreError('pdf not found');
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e instanceof PdfStoreError) throw e;
    throw new PdfStoreError('pdf not found');
  }
}

// ── Public API (driver-agnostic) ───────────────────────────────────────────────────────────
/** Store a PDF buffer; returns its content-address ref (sha256 hex). Idempotent: re-storing dedups. */
export async function putPdf(buf: Buffer): Promise<string> {
  assertValidPdf(buf);
  const ref = createHash('sha256').update(buf).digest('hex');
  if (DRIVER === 's3') {
    await s3Put(ref, buf);
  } else {
    await diskPut(ref, buf);
  }
  return ref;
}

export async function pdfExists(ref: string): Promise<boolean> {
  return DRIVER === 's3' ? s3Exists(ref) : diskExists(ref);
}

export async function readPdf(ref: string): Promise<Buffer> {
  return DRIVER === 's3' ? s3Read(ref) : diskRead(ref);
}
