import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env';
import type { AuthedUser, OutletScope } from '../../common/types/request';

export interface AccessClaims {
  sub: string;
  roleKey: string;
  employeeId: string | null;
  outletIds: string[];
  scope: OutletScope;
  permHash: string;
  mustReset: boolean;
  jti: string;
}

@Injectable()
export class TokenService {
  private readonly accessSecret = new TextEncoder().encode(env().JWT_ACCESS_SECRET);

  async signAccess(claims: Omit<AccessClaims, 'jti'>): Promise<string> {
    return new SignJWT({ ...claims, jti: randomUUID() })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(`${env().JWT_ACCESS_TTL}s`)
      .sign(this.accessSecret);
  }

  async verifyAccess(token: string): Promise<AuthedUser> {
    const { payload } = await jwtVerify(token, this.accessSecret, { algorithms: ['HS256'] });
    const c = payload as unknown as AccessClaims;
    return {
      sub: c.sub,
      roleKey: c.roleKey,
      employeeId: c.employeeId ?? null,
      outletIds: c.outletIds ?? [],
      scope: c.scope,
      permHash: c.permHash,
      mustReset: c.mustReset,
    };
  }

  /** 32 random bytes, base64url. Never a JWT: revocation has to be one UPDATE. */
  newRefreshToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: sha256(token) };
  }

  refreshExpiry(): Date {
    return new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
