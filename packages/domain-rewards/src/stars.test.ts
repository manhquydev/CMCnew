import { describe, it, expect } from 'vitest';
import { starBalance, checkRedeem, earnEntry, redeemEntry, refundEntry } from './stars.js';

describe('starBalance', () => {
  it('sums signed amounts (earn + spend + refund)', () => {
    expect(starBalance([{ amount: 10 }, { amount: 5 }, { amount: -8 }, { amount: 8 }])).toBe(15);
  });
  it('empty ledger = 0', () => {
    expect(starBalance([])).toBe(0);
  });
});

describe('checkRedeem', () => {
  const gift = { starsRequired: 10, stock: 3, isActive: true };
  it('ok when active, in stock, enough balance', () => {
    expect(checkRedeem(10, gift)).toEqual({ ok: true });
  });
  it('rejects inactive gift', () => {
    expect(checkRedeem(100, { ...gift, isActive: false })).toEqual({ ok: false, reason: 'inactive' });
  });
  it('rejects when out of stock (stock=0)', () => {
    expect(checkRedeem(100, { ...gift, stock: 0 })).toEqual({ ok: false, reason: 'out_of_stock' });
  });
  it('allows unlimited stock (-1)', () => {
    expect(checkRedeem(10, { ...gift, stock: -1 })).toEqual({ ok: true });
  });
  it('rejects insufficient balance', () => {
    expect(checkRedeem(9, gift)).toEqual({ ok: false, reason: 'insufficient_stars' });
  });
  it('inactive takes priority over stock/balance', () => {
    expect(checkRedeem(0, { starsRequired: 10, stock: 0, isActive: false })).toEqual({
      ok: false,
      reason: 'inactive',
    });
  });
});

describe('ledger entry builders', () => {
  it('earnEntry: positive, typed, references the submission (idempotency key)', () => {
    expect(earnEntry(5, 'sub-1')).toEqual({ amount: 5, type: 'homework_completed', reference: 'sub-1' });
  });
  it('earnEntry rejects non-positive / non-integer', () => {
    expect(() => earnEntry(0, 'sub-1')).toThrow();
    expect(() => earnEntry(-3, 'sub-1')).toThrow();
    expect(() => earnEntry(1.5, 'sub-1')).toThrow();
  });
  it('redeemEntry: stores negative amount', () => {
    expect(redeemEntry(10, 'rw-1')).toEqual({ amount: -10, type: 'gift_redeemed', reference: 'rw-1' });
  });
  it('refundEntry: positive, distinct type, references the reward', () => {
    expect(refundEntry(10, 'rw-1')).toEqual({ amount: 10, type: 'gift_rejected_refund', reference: 'rw-1' });
  });
  it('redeem then refund nets to zero in the ledger', () => {
    const ledger = [earnEntry(10, 'sub-1'), redeemEntry(10, 'rw-1'), refundEntry(10, 'rw-1')];
    expect(starBalance(ledger)).toBe(10);
  });
});
