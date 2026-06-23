import { describe, it, expect } from 'vitest';
import {
  DISCOUNT_CAP_PERCENT,
  resolvePrice,
  tierPercentForYears,
  effectiveDiscountPercent,
  netAmount,
  grossForYears,
  formatReceiptCode,
  priceReceipt,
  type CoursePriceLike,
} from './pricing.js';

describe('resolvePrice (effective-dated)', () => {
  const prices: CoursePriceLike[] = [
    { effectiveFrom: new Date('2026-01-01'), amount: 10_000_000 },
    { effectiveFrom: new Date('2026-06-01'), amount: 12_000_000 },
    { effectiveFrom: new Date('2027-01-01'), amount: 15_000_000 },
  ];

  it('picks the latest price on or before the date', () => {
    expect(resolvePrice(prices, new Date('2026-06-23'))).toBe(12_000_000);
  });

  it('uses the older price before the next one takes effect', () => {
    expect(resolvePrice(prices, new Date('2026-05-31'))).toBe(10_000_000);
  });

  it('ignores future-dated prices', () => {
    expect(resolvePrice(prices, new Date('2026-12-31'))).toBe(12_000_000);
  });

  it('returns null when no price has taken effect yet', () => {
    expect(resolvePrice(prices, new Date('2025-12-31'))).toBeNull();
  });

  it('is inclusive of the effectiveFrom day', () => {
    expect(resolvePrice(prices, new Date('2026-06-01'))).toBe(12_000_000);
  });
});

describe('tierPercentForYears', () => {
  it('maps 1/2/3 years to 15/20/30', () => {
    expect(tierPercentForYears(1)).toBe(15);
    expect(tierPercentForYears(2)).toBe(20);
    expect(tierPercentForYears(3)).toBe(30);
  });

  it('throws for an unknown year count', () => {
    expect(() => tierPercentForYears(4)).toThrow();
    expect(() => tierPercentForYears(0)).toThrow();
  });

  it('honors a custom tier table', () => {
    expect(tierPercentForYears(1, [{ years: 1, percent: 10 }])).toBe(10);
  });
});

describe('effectiveDiscountPercent (35% cap)', () => {
  it('sums tier and voucher when under the cap', () => {
    expect(effectiveDiscountPercent(15, 10)).toBe(25);
  });

  it('caps the stacked discount at 35', () => {
    expect(effectiveDiscountPercent(30, 20)).toBe(DISCOUNT_CAP_PERCENT);
    expect(effectiveDiscountPercent(30, 5)).toBe(35);
  });

  it('exactly 35 stays 35 (boundary)', () => {
    expect(effectiveDiscountPercent(20, 15)).toBe(35);
  });

  it('defaults voucher to 0', () => {
    expect(effectiveDiscountPercent(30)).toBe(30);
  });

  it('rejects out-of-range percents', () => {
    expect(() => effectiveDiscountPercent(-1, 0)).toThrow();
    expect(() => effectiveDiscountPercent(0, 101)).toThrow();
  });
});

describe('netAmount', () => {
  it('applies the discount', () => {
    expect(netAmount(10_000_000, 35)).toBe(6_500_000);
    expect(netAmount(10_000_000, 0)).toBe(10_000_000);
  });

  it('rounds to the nearest VND', () => {
    // 999 * 0.85 = 849.15 -> 849
    expect(netAmount(999, 15)).toBe(849);
    // 1001 * 0.65 = 650.65 -> 651
    expect(netAmount(1001, 35)).toBe(651);
  });

  it('rejects a non-integer gross', () => {
    expect(() => netAmount(100.5, 10)).toThrow();
  });
});

describe('grossForYears', () => {
  it('multiplies annual price by years', () => {
    expect(grossForYears(10_000_000, 3)).toBe(30_000_000);
    expect(grossForYears(10_000_000, 1)).toBe(10_000_000);
  });
  it('rejects non-positive years', () => {
    expect(() => grossForYears(10_000_000, 0)).toThrow();
  });
});

describe('formatReceiptCode', () => {
  it('zero-pads the sequence to 4', () => {
    expect(formatReceiptCode(2026, 1)).toBe('PT-2026-0001');
    expect(formatReceiptCode(2026, 1234)).toBe('PT-2026-1234');
  });
  it('rejects a non-positive sequence', () => {
    expect(() => formatReceiptCode(2026, 0)).toThrow();
  });
});

describe('priceReceipt (end-to-end)', () => {
  it('3 years + 20% voucher caps at 35 and computes net', () => {
    const r = priceReceipt({ gross: 12_000_000, years: 3, voucherPercent: 20 });
    expect(r.tierPercent).toBe(30);
    expect(r.voucherPercent).toBe(20);
    expect(r.effectiveDiscountPercent).toBe(35);
    expect(r.netAmount).toBe(7_800_000); // 12,000,000 * 0.65
  });

  it('1 year, no voucher', () => {
    const r = priceReceipt({ gross: 10_000_000, years: 1 });
    expect(r.effectiveDiscountPercent).toBe(15);
    expect(r.netAmount).toBe(8_500_000);
  });

  it('2 years + 10% voucher stays under the cap', () => {
    const r = priceReceipt({ gross: 10_000_000, years: 2, voucherPercent: 10 });
    expect(r.effectiveDiscountPercent).toBe(30);
    expect(r.netAmount).toBe(7_000_000);
  });
});
