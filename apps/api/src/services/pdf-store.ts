import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

// Content-addressed local PDF store. The exercise base PDF is stored ONCE under its sha256
// (spec §3 dedup) — identical uploads collapse to one file. This is the storage DRIVER behind
// the `basePdfRef` seam; swapping to MinIO/S3 later (see DEBT) changes only this module.
const STORE_DIR = process.env.PDF_STORE_DIR ?? path.resolve(process.cwd(), '.data/pdf');

// Guard the input: cap size and require the %PDF magic so the store only ever holds PDFs.
export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB — bound input bloat at the door (spec §3).
const PDF_MAGIC = Buffer.from('%PDF-');

export class PdfStoreError extends Error {}

function refToFile(ref: string): string {
  // ref is a 64-char lowercase hex sha256 — reject anything else so it can't escape STORE_DIR.
  if (!/^[a-f0-9]{64}$/.test(ref)) throw new PdfStoreError('invalid pdf ref');
  return path.join(STORE_DIR, `${ref}.pdf`);
}

/** Store a PDF buffer; returns its content-address ref (sha256 hex). Idempotent: re-storing dedups. */
export async function putPdf(buf: Buffer): Promise<string> {
  if (buf.length === 0) throw new PdfStoreError('empty file');
  if (buf.length > MAX_PDF_BYTES) throw new PdfStoreError('file too large');
  if (!buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw new PdfStoreError('not a PDF');
  const ref = createHash('sha256').update(buf).digest('hex');
  const file = refToFile(ref);
  await mkdir(STORE_DIR, { recursive: true });
  try {
    await access(file, constants.F_OK); // already stored → dedup, skip write.
  } catch {
    await writeFile(file, buf);
  }
  return ref;
}

export async function pdfExists(ref: string): Promise<boolean> {
  try {
    await access(refToFile(ref), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readPdf(ref: string): Promise<Buffer> {
  try {
    return await readFile(refToFile(ref));
  } catch {
    throw new PdfStoreError('pdf not found');
  }
}
