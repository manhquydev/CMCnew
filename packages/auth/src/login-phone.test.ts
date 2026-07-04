import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDENT_PASSWORD, normalizeLoginPhone } from './login-phone.js';

describe('normalizeLoginPhone', () => {
  it('normalizes a leading-0 VN mobile to 84xxx', () => {
    expect(normalizeLoginPhone('0912345678')).toBe('84912345678');
  });

  it('normalizes a +84 prefix to bare 84', () => {
    expect(normalizeLoginPhone('+84912345678')).toBe('84912345678');
  });

  it('passes through an already-bare 84xxx', () => {
    expect(normalizeLoginPhone('84912345678')).toBe('84912345678');
  });

  it('normalizes a 0084 prefix to bare 84', () => {
    expect(normalizeLoginPhone('0084912345678')).toBe('84912345678');
  });

  it('strips spaces and dashes before normalizing', () => {
    expect(normalizeLoginPhone('0912 345 678')).toBe('84912345678');
    expect(normalizeLoginPhone('091-234-5678')).toBe('84912345678');
  });

  it('returns null for a too-short number', () => {
    expect(normalizeLoginPhone('091234567')).toBeNull();
  });

  it('returns null for a too-long number', () => {
    expect(normalizeLoginPhone('0912345678901')).toBeNull();
  });

  it('returns null for non-phone input', () => {
    expect(normalizeLoginPhone('not a phone')).toBeNull();
    expect(normalizeLoginPhone('')).toBeNull();
    expect(normalizeLoginPhone(null)).toBeNull();
    expect(normalizeLoginPhone(undefined)).toBeNull();
  });
});

describe('DEFAULT_STUDENT_PASSWORD', () => {
  it('is the fixed literal, not random', () => {
    expect(DEFAULT_STUDENT_PASSWORD).toBe('Cmc2026@');
  });
});
