import { describe, it, expect } from 'vitest';
import { ssoConfigFromEnv, emailAllowed, emailFromClaims } from '../src/lib/sso.js';

// Pure unit tests for the SSO helpers (no IdP / network). The full OIDC redirect round-trip is
// verified live in R6 once the tenant secret + redirect URI are configured.

describe('ssoConfigFromEnv', () => {
  it('returns null when the client secret is unset (SSO disabled)', () => {
    const saved = { ...process.env };
    delete process.env.ENTRA_CLIENT_SECRET;
    delete process.env.GRAPH_CLIENT_SECRET;
    expect(ssoConfigFromEnv()).toBeNull();
    Object.assign(process.env, saved);
  });

  it('returns config when all fields are present', () => {
    const saved = { ...process.env };
    process.env.ENTRA_TENANT_ID = 't';
    process.env.ENTRA_CLIENT_ID = 'c';
    process.env.ENTRA_CLIENT_SECRET = 's';
    process.env.ERP_SSO_REDIRECT_URI = 'http://localhost:4000/auth/sso/callback';
    process.env.STAFF_EMAIL_DOMAIN = 'cmcvn.edu.vn';
    expect(ssoConfigFromEnv()).toMatchObject({ tenantId: 't', clientId: 'c', emailDomain: 'cmcvn.edu.vn' });
    process.env = saved;
  });
});

describe('emailAllowed', () => {
  it('accepts the org domain (case-insensitive) and rejects others', () => {
    expect(emailAllowed('Nguyen.A@CMCVN.edu.vn', 'cmcvn.edu.vn')).toBe(true);
    expect(emailAllowed('a@gmail.com', 'cmcvn.edu.vn')).toBe(false);
    expect(emailAllowed('a@evilcmcvn.edu.vn', 'cmcvn.edu.vn')).toBe(false);
  });
});

describe('emailFromClaims', () => {
  it('prefers preferred_username, falls back to email then upn', () => {
    expect(emailFromClaims({ preferred_username: 'a@x.vn', email: 'b@x.vn' })).toBe('a@x.vn');
    expect(emailFromClaims({ email: 'b@x.vn' })).toBe('b@x.vn');
    expect(emailFromClaims({ upn: 'c@x.vn' })).toBe('c@x.vn');
    expect(emailFromClaims({ name: 'no email' })).toBeNull();
  });
});
