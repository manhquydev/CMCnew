import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_SESSION_PHOTO_BYTES = 8 * 1024 * 1024;

const PHOTO_REF_PATTERN = /^[a-f0-9]{64}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF_MAGIC = Buffer.from('RIFF');
const WEBP_MAGIC = Buffer.from('WEBP');

export type SessionPhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export class PhotoStoreError extends Error {}

function storeDir(): string {
  return process.env.SESSION_PHOTO_STORE_DIR ?? path.resolve(process.cwd(), '.data/session-photos');
}

function refToFile(ref: string): string {
  if (!PHOTO_REF_PATTERN.test(ref)) throw new PhotoStoreError('invalid photo ref');
  return path.join(storeDir(), ref);
}

function detectPhotoContentType(buf: Buffer): SessionPhotoContentType | null {
  if (buf.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'image/png';
  if (
    buf.length >= 12 &&
    buf.subarray(0, RIFF_MAGIC.length).equals(RIFF_MAGIC) &&
    buf.subarray(8, 12).equals(WEBP_MAGIC)
  ) {
    return 'image/webp';
  }
  return null;
}

export function assertValidSessionPhoto(buf: Buffer): SessionPhotoContentType {
  if (buf.length === 0) throw new PhotoStoreError('empty file');
  if (buf.length > MAX_SESSION_PHOTO_BYTES) throw new PhotoStoreError('file too large');
  const contentType = detectPhotoContentType(buf);
  if (!contentType) throw new PhotoStoreError('not a supported image');
  return contentType;
}

export async function putSessionPhoto(buf: Buffer): Promise<string> {
  assertValidSessionPhoto(buf);
  const ref = createHash('sha256').update(buf).digest('hex');
  const file = refToFile(ref);
  await mkdir(storeDir(), { recursive: true });
  try {
    await access(file, constants.F_OK);
  } catch {
    await writeFile(file, buf);
  }
  return ref;
}

export async function sessionPhotoExists(ref: string): Promise<boolean> {
  try {
    await access(refToFile(ref), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readSessionPhoto(ref: string): Promise<{ buffer: Buffer; contentType: SessionPhotoContentType }> {
  try {
    const buffer = await readFile(refToFile(ref));
    return { buffer, contentType: assertValidSessionPhoto(buffer) };
  } catch (e) {
    if (e instanceof PhotoStoreError) throw e;
    throw new PhotoStoreError('photo not found');
  }
}
