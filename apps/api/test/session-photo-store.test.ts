import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SESSION_PHOTO_BYTES,
  PhotoStoreError,
  assertValidSessionPhoto,
  putSessionPhoto,
  readSessionPhoto,
  sessionPhotoExists,
} from '../src/services/photo-store.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);
const webp = Buffer.from('RIFFxxxxWEBPpayload');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cmc-session-photos-'));
  process.env.SESSION_PHOTO_STORE_DIR = dir;
});

afterEach(async () => {
  delete process.env.SESSION_PHOTO_STORE_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('session photo store', () => {
  it('accepts png, jpeg, and webp magic bytes', () => {
    expect(assertValidSessionPhoto(png)).toBe('image/png');
    expect(assertValidSessionPhoto(jpeg)).toBe('image/jpeg');
    expect(assertValidSessionPhoto(webp)).toBe('image/webp');
  });

  it('rejects empty, oversized, and non-image uploads', () => {
    expect(() => assertValidSessionPhoto(Buffer.alloc(0))).toThrow(PhotoStoreError);
    expect(() => assertValidSessionPhoto(Buffer.alloc(MAX_SESSION_PHOTO_BYTES + 1, 0xff))).toThrow(PhotoStoreError);
    expect(() => assertValidSessionPhoto(Buffer.from('<svg onload=alert(1)>'))).toThrow(PhotoStoreError);
  });

  it('stores photos by sha256 ref and reads content type back from bytes', async () => {
    const ref = await putSessionPhoto(png);

    expect(ref).toMatch(/^[a-f0-9]{64}$/);
    expect(await sessionPhotoExists(ref)).toBe(true);
    const stored = await readSessionPhoto(ref);
    expect(stored.contentType).toBe('image/png');
    expect(stored.buffer.equals(png)).toBe(true);
  });

  it('rejects invalid refs before touching the filesystem', async () => {
    await expect(sessionPhotoExists('../escape')).resolves.toBe(false);
    await expect(readSessionPhoto('../escape')).rejects.toThrow(PhotoStoreError);
  });
});
