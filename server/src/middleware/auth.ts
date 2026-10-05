import type { Request, RequestHandler } from 'express';
import { forbidden, HttpError, unauthorized } from '../lib/httpError';
import type { TokenService } from '../lib/tokens';
import { type Role, User } from '../models/user';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  villageIds: string[];
  patientId: string | null;
  mustChangePassword: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Verifies the bearer access token and loads the user on every request, so deactivation,
 * logout (token version bump) and village reassignment take effect immediately.
 *
 * A user with a temporary password is refused everywhere (403 PASSWORD_CHANGE_REQUIRED) except
 * on routes that pass `allowPendingPasswordChange` (change password, /me, logout).
 */
export function authenticate(
  tokens: TokenService,
  opts: { allowPendingPasswordChange?: boolean } = {},
): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const claims = tokens.verifyAccess(header.slice('Bearer '.length));

    const user = await User.findById(claims.sub);
    if (!user || user.tokenVersion !== claims.tv) throw unauthorized('Session expired, please log in again');
    if (!user.isActive) throw forbidden('Account is disabled');
    if (user.mustChangePassword && !opts.allowPendingPasswordChange) {
      throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please set a new password first');
    }

    req.user = {
      id: user.id,
      name: user.name,
      role: user.role,
      villageIds: user.villageIds.map(String),
      patientId: user.patientId ? String(user.patientId) : null,
      mustChangePassword: user.mustChangePassword ?? false,
    };
    next();
  };
}

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden(`Requires role: ${roles.join(' or ')}`);
    next();
  };

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
