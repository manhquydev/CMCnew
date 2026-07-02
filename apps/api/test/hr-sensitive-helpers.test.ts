/**
 * Unit tests for HR sensitive-field helpers (decision 0026).
 *
 * maskSensitive — pure formatting: null passthrough, short-value full-mask,
 * long-value last-4 reveal.
 * canReadSensitiveHr — role predicate: super_admin bypass, both directors
 * pass, all other roles fail.
 */
import { describe, it, expect } from 'vitest';
import { maskSensitive, canReadSensitiveHr, isMaskedPlaceholder } from '@cmc/auth';

describe('maskSensitive', () => {
  it('returns null for null/undefined input', () => {
    expect(maskSensitive(null)).toBeNull();
    expect(maskSensitive(undefined)).toBeNull();
  });

  it('fully masks values of 4 characters or fewer', () => {
    expect(maskSensitive('1234')).toBe('••••');
    expect(maskSensitive('12')).toBe('••••');
    expect(maskSensitive('')).toBe('••••');
  });

  it('reveals only the last 4 characters for longer values', () => {
    expect(maskSensitive('0123456789')).toBe('•••••••• 6789');
    expect(maskSensitive('0010987654321')).toBe('•••••••• 4321');
  });

  it('does not leak the original length beyond the last-4 reveal', () => {
    const masked = maskSensitive('a-very-long-ccc-number-1234567890');
    expect(masked).toBe('•••••••• 7890');
    expect(masked).not.toContain('a-very-long');
  });
});

describe('canReadSensitiveHr', () => {
  it('allows super_admin regardless of roles array', () => {
    expect(canReadSensitiveHr({ isSuperAdmin: true, roles: [] })).toBe(true);
  });

  it('allows giam_doc_kinh_doanh', () => {
    expect(
      canReadSensitiveHr({ isSuperAdmin: false, roles: ['giam_doc_kinh_doanh'] }),
    ).toBe(true);
  });

  it('allows giam_doc_dao_tao', () => {
    expect(
      canReadSensitiveHr({ isSuperAdmin: false, roles: ['giam_doc_dao_tao'] }),
    ).toBe(true);
  });

  it('allows a multi-role account that includes a director role', () => {
    expect(
      canReadSensitiveHr({
        isSuperAdmin: false,
        roles: ['sale', 'giam_doc_kinh_doanh'],
      }),
    ).toBe(true);
  });

  it('denies non-privileged roles', () => {
    for (const role of ['sale', 'cskh', 'ke_toan', 'hr', 'giao_vien', 'ctv_mkt']) {
      expect(
        canReadSensitiveHr({ isSuperAdmin: false, roles: [role] }),
      ).toBe(false);
    }
  });

  it('denies an empty roles array without super_admin', () => {
    expect(canReadSensitiveHr({ isSuperAdmin: false, roles: [] })).toBe(false);
  });
});

describe('isMaskedPlaceholder', () => {
  it('recognizes both maskSensitive() output shapes', () => {
    expect(isMaskedPlaceholder(maskSensitive('1234'))).toBe(true);
    expect(isMaskedPlaceholder(maskSensitive('0123456789'))).toBe(true);
  });

  it('does not flag a real value that happens to contain a bullet mid-string', () => {
    expect(isMaskedPlaceholder('123•456')).toBe(false);
  });

  it('does not flag ordinary real values, null, or undefined', () => {
    expect(isMaskedPlaceholder('012345678901')).toBe(false);
    expect(isMaskedPlaceholder(null)).toBe(false);
    expect(isMaskedPlaceholder(undefined)).toBe(false);
    expect(isMaskedPlaceholder('')).toBe(false);
  });
});
