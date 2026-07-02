import { describe, it, expect } from 'vitest';
import { decideTransport, isValidEmailFormat } from '../src/lib/email-routing.js';

describe('decideTransport', () => {
  it('routes a staff-domain recipient to graph', () => {
    const saved = process.env.STAFF_EMAIL_DOMAIN;
    process.env.STAFF_EMAIL_DOMAIN = 'cmcvn.edu.vn';
    expect(decideTransport('teacher@cmcvn.edu.vn')).toBe('graph');
    expect(decideTransport('Teacher@CMCVN.EDU.VN')).toBe('graph'); // case-insensitive
    process.env.STAFF_EMAIL_DOMAIN = saved;
  });

  it('routes an external recipient to brevo', () => {
    const saved = process.env.STAFF_EMAIL_DOMAIN;
    process.env.STAFF_EMAIL_DOMAIN = 'cmcvn.edu.vn';
    expect(decideTransport('parent@gmail.com')).toBe('brevo');
    process.env.STAFF_EMAIL_DOMAIN = saved;
  });

  it('defaults everyone to graph when STAFF_EMAIL_DOMAIN is unset (preserves current behavior)', () => {
    const saved = process.env.STAFF_EMAIL_DOMAIN;
    delete process.env.STAFF_EMAIL_DOMAIN;
    expect(decideTransport('anyone@anywhere.com')).toBe('graph');
    if (saved !== undefined) process.env.STAFF_EMAIL_DOMAIN = saved;
  });
});

describe('isValidEmailFormat', () => {
  it('accepts a normal address', () => {
    expect(isValidEmailFormat('a@b.com')).toBe(true);
  });
  it('rejects empty, no-@, and leading/trailing-@ strings', () => {
    expect(isValidEmailFormat('')).toBe(false);
    expect(isValidEmailFormat('notanemail')).toBe(false);
    expect(isValidEmailFormat('@b.com')).toBe(false);
    expect(isValidEmailFormat('a@')).toBe(false);
  });
});
