/** Pure star-ledger logic. Balance = SUM(ledger). The DB enforces atomicity
 * (advisory lock + UPDATE … WHERE stock>0) and idempotency (@@unique(type,reference));
 * this module computes balances, validates redemptions, and shapes ledger entries. */

export type StarTxnType =
  | 'homework_completed'
  | 'gift_redeemed'
  | 'gift_rejected_refund'
  | 'manual';

export interface StarEntry {
  amount: number; // + earned, - spent
  type: StarTxnType;
  reference: string | null;
}

/** Current balance from the ledger (single source of truth — no cached column). */
export function starBalance(entries: readonly { amount: number }[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

export interface GiftLike {
  starsRequired: number;
  stock: number; // -1 = unlimited
  isActive: boolean;
}

export type RedeemCheck =
  | { ok: true }
  | { ok: false; reason: 'inactive' | 'out_of_stock' | 'insufficient_stars' };

/** Validate a redemption BEFORE the atomic DB write. The DB still re-checks stock
 * under lock (the source of truth for double-spend); this gives a fast, clear reason. */
export function checkRedeem(balance: number, gift: GiftLike): RedeemCheck {
  if (!gift.isActive) return { ok: false, reason: 'inactive' };
  if (gift.stock === 0) return { ok: false, reason: 'out_of_stock' };
  if (balance < gift.starsRequired) return { ok: false, reason: 'insufficient_stars' };
  return { ok: true };
}

/** Earn entry for a graded submission. `reference` = submission id → DB unique makes it idempotent. */
export function earnEntry(amount: number, submissionId: string): StarEntry {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('earn amount must be a positive integer');
  }
  return { amount, type: 'homework_completed', reference: submissionId };
}

/** Spend entry for a redemption. `reference` = reward id. Amount stored negative. */
export function redeemEntry(starsRequired: number, rewardId: string): StarEntry {
  if (!Number.isInteger(starsRequired) || starsRequired <= 0) {
    throw new Error('starsRequired must be a positive integer');
  }
  return { amount: -starsRequired, type: 'gift_redeemed', reference: rewardId };
}

/** Refund entry when a pending redemption is rejected. `reference` = reward id (distinct type
 * keeps it unique alongside the original gift_redeemed row). */
export function refundEntry(stars: number, rewardId: string): StarEntry {
  if (!Number.isInteger(stars) || stars <= 0) {
    throw new Error('refund stars must be a positive integer');
  }
  return { amount: stars, type: 'gift_rejected_refund', reference: rewardId };
}
