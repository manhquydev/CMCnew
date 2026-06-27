// Microsoft Entra SSO for ERP staff (R4, OpenID Connect authorization-code flow with PKCE). Uses
// @azure/msal-node ConfidentialClientApplication. After Microsoft validates the user, we extract the
// email, enforce the org domain, and let the caller mint our own staff session — Microsoft passwords
// are never stored. Single-tenant authority pins logins to the CMC tenant.
//
// Pure helpers (config, domain check, claim extraction) are unit-testable; the MSAL client is
// lazy-imported so the dependency never loads when SSO is unconfigured.

const OIDC_SCOPES = ['openid', 'profile', 'email'];

export interface SsoConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  emailDomain: string;
}

/** Read SSO config from env; null when the client secret (or any required field) is unset → SSO off. */
export function ssoConfigFromEnv(): SsoConfig | null {
  const tenantId = process.env.ENTRA_TENANT_ID || process.env.GRAPH_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID || process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET || process.env.GRAPH_CLIENT_SECRET;
  const redirectUri = process.env.ERP_SSO_REDIRECT_URI;
  const emailDomain = process.env.STAFF_EMAIL_DOMAIN;
  if (!tenantId || !clientId || !clientSecret || !redirectUri || !emailDomain) return null;
  return { tenantId, clientId, clientSecret, redirectUri, emailDomain };
}

/** True when an email belongs to the org domain (case-insensitive). Second lock atop single-tenant. */
export function emailAllowed(email: string, domain: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${domain.trim().toLowerCase()}`);
}

/** Pull the user's email from id_token claims (preferred_username → email → upn). */
export function emailFromClaims(claims: Record<string, unknown>): string | null {
  const candidate = claims.preferred_username ?? claims.email ?? claims.upn;
  return typeof candidate === 'string' && candidate.includes('@') ? candidate : null;
}

async function clientFor(cfg: SsoConfig) {
  const { ConfidentialClientApplication } = await import('@azure/msal-node');
  return new ConfidentialClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      clientSecret: cfg.clientSecret,
    },
  });
}

export interface AuthRequestState {
  url: string;
  /** Opaque transaction state to round-trip via an httpOnly cookie (CSRF + PKCE verifier). */
  tx: { state: string; verifier: string };
}

/** Build the Microsoft authorize URL + the PKCE/state to stash in a short-lived cookie. */
export async function buildAuthUrl(cfg: SsoConfig): Promise<AuthRequestState> {
  const { CryptoProvider } = await import('@azure/msal-node');
  const crypto = new CryptoProvider();
  const { verifier, challenge } = await crypto.generatePkceCodes();
  const state = crypto.base64Encode(`${Date.now()}.${crypto.createNewGuid()}`);
  const cca = await clientFor(cfg);
  const url = await cca.getAuthCodeUrl({
    scopes: OIDC_SCOPES,
    redirectUri: cfg.redirectUri,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state,
    prompt: 'select_account',
  });
  return { url, tx: { state, verifier } };
}

/**
 * Exchange the authorization code for tokens (MSAL validates issuer/audience/nonce/signature), then
 * return the org-domain email. Returns null if the tenant/domain check fails or no email is present.
 */
export async function redeemCode(cfg: SsoConfig, code: string, verifier: string): Promise<string | null> {
  const cca = await clientFor(cfg);
  const res = await cca.acquireTokenByCode({
    code,
    scopes: OIDC_SCOPES,
    redirectUri: cfg.redirectUri,
    codeVerifier: verifier,
  });
  const claims = (res.idTokenClaims ?? {}) as Record<string, unknown>;
  if (claims.tid && claims.tid !== cfg.tenantId) return null; // tenant pin
  const email = emailFromClaims(claims);
  if (!email || !emailAllowed(email, cfg.emailDomain)) return null;
  return email.toLowerCase();
}
