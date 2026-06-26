// Account activation & password-reset tokens (Phases 02/04). Issues a single-use, short-lived token,
// stores only its SHA-256 hash (the raw token lives only in the emailed link), and enqueues the
// matching email. Verification/consumption hashes the presented token and matches the stored hash.
// All functions take a tx so issuing participates in the caller's business transaction.

import { randomBytes, createHash } from 'node:crypto';
import type { Prisma } from '@cmc/db';
import { enqueueEmail } from './email-outbox.js';

type Tx = Prisma.TransactionClient;

export type ActivationKind = 'parent_account' | 'staff_account' | 'password_reset';
export type SubjectType = 'parent' | 'staff';

const ACTIVATION_TTL_HOURS = 24;
const RESET_TTL_MINUTES = 30;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Build the frontend link for a token. Parent links go to the LMS app, staff links to admin. */
function linkFor(subjectType: SubjectType, path: 'activate' | 'reset', rawToken: string): string {
  const origin =
    subjectType === 'parent'
      ? process.env.LMS_APP_ORIGIN ?? 'http://localhost:5175'
      : process.env.ADMIN_APP_ORIGIN ?? 'http://localhost:5173';
  return `${origin.replace(/\/$/, '')}/${path}?token=${rawToken}`;
}

export interface IssueInput {
  kind: ActivationKind;
  subjectType: SubjectType;
  subjectId: string;
  email: string;
  name?: string;
  /** dedup suffix so re-issuing for the same subject+purpose replaces intent without piling up emails. */
  dedupKey: string;
  mailbox?: 'notify' | 'hr';
}

/**
 * Create a token + enqueue its email inside the caller's tx. Returns the raw token (tests/dev only;
 * production never logs it). Activation tokens live 24h; reset tokens 30m.
 */
export async function issueActivation(tx: Tx, input: IssueInput): Promise<string> {
  const rawToken = randomBytes(32).toString('base64url');
  const isReset = input.kind === 'password_reset';
  const ttlMs = isReset ? RESET_TTL_MINUTES * 60_000 : ACTIVATION_TTL_HOURS * 3_600_000;
  // now is taken from the DB clock via default; we compute expiry relative to JS now (close enough;
  // tokens are short-lived and compared against now() at verify time).
  const expiresAt = new Date(Date.now() + ttlMs);

  await tx.activationToken.create({
    data: {
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      tokenHash: sha256(rawToken),
      expiresAt,
    },
  });

  const path = isReset ? 'reset' : 'activate';
  const url = linkFor(input.subjectType, path, rawToken);
  const mailbox = input.mailbox ?? 'notify';

  if (input.kind === 'parent_account') {
    await enqueueEmail(tx, {
      dedupKey: input.dedupKey,
      to: input.email,
      mailbox,
      kind: 'parent_welcome',
      data: { parentName: input.name, activationUrl: url, expiresHours: ACTIVATION_TTL_HOURS },
    });
  } else if (input.kind === 'staff_account') {
    await enqueueEmail(tx, {
      dedupKey: input.dedupKey,
      to: input.email,
      mailbox,
      kind: 'staff_welcome',
      data: { displayName: input.name, activationUrl: url, expiresHours: ACTIVATION_TTL_HOURS },
    });
  } else {
    await enqueueEmail(tx, {
      dedupKey: input.dedupKey,
      to: input.email,
      mailbox,
      kind: 'password_reset',
      data: { name: input.name, resetUrl: url, expiresMinutes: RESET_TTL_MINUTES },
    });
  }
  return rawToken;
}

export interface VerifiedToken {
  id: string;
  kind: ActivationKind;
  subjectType: SubjectType;
  subjectId: string;
}

/**
 * Look up a presented raw token: must exist, be unconsumed and unexpired. Returns the row or null.
 * Does NOT consume — call consumeToken inside the same tx after the password is set.
 */
export async function verifyToken(
  tx: Tx,
  rawToken: string,
  allowedKinds?: ActivationKind[],
): Promise<VerifiedToken | null> {
  const row = await tx.activationToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null;
  if (allowedKinds && !allowedKinds.includes(row.kind as ActivationKind)) return null;
  return {
    id: row.id,
    kind: row.kind as ActivationKind,
    subjectType: row.subjectType as SubjectType,
    subjectId: row.subjectId,
  };
}

/** Mark a token consumed (single-use). Call after applying the password change in the same tx. */
export async function consumeToken(tx: Tx, id: string): Promise<void> {
  await tx.activationToken.update({ where: { id }, data: { consumedAt: new Date() } });
}
