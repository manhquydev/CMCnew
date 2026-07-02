// One-shot migration: copy existing local PDF blobs (`.data/pdf/*`) into the S3/MinIO bucket,
// keyed by their existing sha256 ref — see plans/260702-1007-lms-homework-pdf-completion/phase-04-minio-blob-store.md.
// COPY, not move: `.data/pdf` is left untouched so `PDF_STORE_DRIVER` can be flipped back to
// 'disk' instantly if the S3 cutover needs to be rolled back.
//
// Run from apps/api (so `@aws-sdk/client-s3` resolves from its node_modules); pass env vars
// directly or via Node's built-in --env-file flag (repo-root .env uses S3_* / PDF_STORE_DIR):
//   pnpm --filter @cmc/api exec tsx --env-file=../../.env scripts/migrate-pdf-blobs-to-s3.ts
//
// Requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (+ optional S3_REGION,
// S3_FORCE_PATH_STYLE, PDF_STORE_DIR). Does NOT read/write PDF_STORE_DRIVER — flipping the
// driver is a separate, deliberate step after this script's counts are verified.
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { S3Client, PutObjectCommand, HeadObjectCommand, NotFound } from '@aws-sdk/client-s3';

const STORE_DIR = process.env.PDF_STORE_DIR ?? path.resolve(process.cwd(), '.data/pdf');
const REF_PATTERN = /^[a-f0-9]{64}\.pdf$/;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required to run the migration`);
  return v;
}

async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    if (e instanceof NotFound) return false;
    if (
      e &&
      typeof e === 'object' &&
      '$metadata' in e &&
      (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
    ) {
      return false;
    }
    throw e;
  }
}

async function main() {
  const bucket = requireEnv('S3_BUCKET');
  const client = new S3Client({
    endpoint: requireEnv('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY'),
      secretAccessKey: requireEnv('S3_SECRET_KEY'),
    },
  });

  let entries: string[];
  try {
    entries = (await readdir(STORE_DIR)).filter((f) => REF_PATTERN.test(f));
  } catch {
    console.log(`No local PDF store found at ${STORE_DIR} — nothing to migrate.`);
    return;
  }

  console.log(
    `Found ${entries.length} local PDF blob(s) in ${STORE_DIR}. Target bucket: ${bucket}.`,
  );

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of entries) {
    const key = file; // already `${sha256}.pdf`
    try {
      if (await objectExists(client, bucket, key)) {
        skipped++;
        continue;
      }
      const buf = await readFile(path.join(STORE_DIR, file));
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buf,
          ContentType: 'application/pdf',
        }),
      );
      const verified = await objectExists(client, bucket, key);
      if (!verified) throw new Error('post-write HeadObject did not confirm the copy');
      copied++;
    } catch (e) {
      failed++;
      console.error(`FAILED: ${file}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `Migration done. copied=${copied} skipped(already-present)=${skipped} failed=${failed} total=${entries.length}`,
  );
  if (failed > 0) {
    console.error(
      'One or more blobs failed to migrate — do NOT flip PDF_STORE_DRIVER=s3 until re-run is clean.',
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
