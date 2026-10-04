import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Env } from '../config/env';
import type { Role } from '../models/user';
import { unauthorized } from './httpError';

type TokenType = 'access' | 'refresh';

export interface TokenClaims {
  sub: string;
  role: Role;
  /** User.tokenVersion at issue time; bumping it (logout, deactivation) revokes all tokens. */
  tv: number;
  typ: TokenType;
}

export interface TokenUser {
  id: string;
  role: Role;
  tokenVersion: number;
}

export type TokenService = ReturnType<typeof createTokenService>;

export function createTokenService(
  env: Pick<Env, 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET' | 'JWT_ACCESS_TTL' | 'JWT_REFRESH_TTL'>,
) {
  const config = {
    access: { secret: env.JWT_ACCESS_SECRET, ttl: env.JWT_ACCESS_TTL },
    refresh: { secret: env.JWT_REFRESH_SECRET, ttl: env.JWT_REFRESH_TTL },
  } as const;

  const sign = (user: TokenUser, typ: TokenType) =>
    jwt.sign({ role: user.role, tv: user.tokenVersion, typ }, config[typ].secret, {
      subject: user.id,
      expiresIn: config[typ].ttl as SignOptions['expiresIn'],
      algorithm: 'HS256',
    });

  const verify = (token: string, typ: TokenType): TokenClaims => {
    try {
      const claims = jwt.verify(token, config[typ].secret, { algorithms: ['HS256'] }) as TokenClaims;
      if (claims.typ !== typ) throw new Error('wrong token type');
      return claims;
    } catch {
      throw unauthorized('Invalid or expired token');
    }
  };

  return {
    issuePair: (user: TokenUser) => ({
      accessToken: sign(user, 'access'),
      refreshToken: sign(user, 'refresh'),
      tokenType: 'Bearer' as const,
    }),
    verifyAccess: (token: string) => verify(token, 'access'),
    verifyRefresh: (token: string) => verify(token, 'refresh'),
  };
}
