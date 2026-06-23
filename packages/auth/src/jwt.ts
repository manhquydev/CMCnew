import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@cmc/db';

/** What we put in the JWT. Facility scope is intentionally NOT here — it is
 * resolved from the DB on every request so revocation is immediate. */
export interface SessionClaims {
  sub: string;
  roles: Role[];
  primaryRole: Role;
  tokenVersion: number;
}

const encoder = new TextEncoder();

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  // HS256 wants >=256 bits of key material. Reject anything under 32 chars.
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET missing or too short (>=32 chars; e.g. `openssl rand -base64 32`)');
  }
  return encoder.encode(s);
}

export async function signSession(claims: SessionClaims, ttl = '12h'): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      sub: String(payload.sub),
      roles: payload.roles as Role[],
      primaryRole: payload.primaryRole as Role,
      tokenVersion: Number(payload.tokenVersion),
    };
  } catch {
    return null;
  }
}

/** LMS principal (parent/student) token. Student ownership is resolved from the DB
 * on every request (like facility scope), so it is NOT baked into the token. */
export interface LmsClaims {
  sub: string;
  kind: 'parent' | 'student';
  tokenVersion: number;
}

export async function signLmsSession(claims: LmsClaims, ttl = '12h'): Promise<string> {
  return new SignJWT({ kind: claims.kind, tokenVersion: claims.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

export async function verifyLmsToken(token: string): Promise<LmsClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const kind = payload.kind;
    if (kind !== 'parent' && kind !== 'student') return null;
    return { sub: String(payload.sub), kind, tokenVersion: Number(payload.tokenVersion) };
  } catch {
    return null;
  }
}
