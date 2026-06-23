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
  if (!s || s.length < 16) throw new Error('JWT_SECRET missing or too short');
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
