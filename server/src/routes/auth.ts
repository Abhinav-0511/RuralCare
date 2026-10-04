import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { Env } from '../config/env';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../lib/httpError';
import type { TokenService } from '../lib/tokens';
import { authenticate, currentUser } from '../middleware/auth';
import { Patient } from '../models/patient';
import { User } from '../models/user';
import { Village } from '../models/village';
import { LoginBodySchema, RefreshBodySchema, RegisterBodySchema } from '../schemas/api';

const tokenUser = (u: {
  id: string;
  role: 'patient' | 'health_worker' | 'doctor' | 'admin';
  tokenVersion: number;
}) => ({
  id: u.id,
  role: u.role,
  tokenVersion: u.tokenVersion,
});

export function authRouter(deps: { tokens: TokenService; env: Pick<Env, 'BCRYPT_ROUNDS'> }) {
  const r = Router();
  // Compared against when the phone is unknown, so response time doesn't reveal which numbers exist.
  const dummyHash = bcrypt.hash('not-a-real-password', deps.env.BCRYPT_ROUNDS);

  /** Patient self-registration. Staff accounts are created by an admin (POST /api/users). */
  r.post('/register', async (req, res) => {
    const body = RegisterBodySchema.parse(req.body);
    if (!(await Village.exists({ _id: body.villageId })))
      throw badRequest('UNKNOWN_VILLAGE', 'Village not found');
    if (await User.exists({ phone: body.phone })) {
      throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');
    }

    // User first: if the phone is taken in a race, the unique index fails before any patient is created.
    const user = await User.create({
      name: body.name,
      phone: body.phone,
      passwordHash: await bcrypt.hash(body.password, deps.env.BCRYPT_ROUNDS),
      role: 'patient',
      ...(body.preferredLanguage ? { preferredLanguage: body.preferredLanguage } : {}),
    });
    const patient = await Patient.create({
      name: body.name,
      sex: body.sex,
      dateOfBirth: new Date(body.dateOfBirth),
      villageId: body.villageId,
      phone: body.phone,
      userId: user._id,
      registeredBy: user._id,
    });
    user.patientId = patient._id;
    await user.save();

    res.status(201).json({ user: user.toJSON(), tokens: deps.tokens.issuePair(tokenUser(user)) });
  });

  r.post('/login', async (req, res) => {
    const { phone, password } = LoginBodySchema.parse(req.body);
    const user = await User.findOne({ phone }).select('+passwordHash');
    const valid = await bcrypt.compare(password, user?.passwordHash ?? (await dummyHash));
    if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid phone number or password');
    if (!user.isActive) throw forbidden('Account is disabled');

    res.json({ user: user.toJSON(), tokens: deps.tokens.issuePair(tokenUser(user)) });
  });

  r.post('/refresh', async (req, res) => {
    const { refreshToken } = RefreshBodySchema.parse(req.body);
    const claims = deps.tokens.verifyRefresh(refreshToken);
    const user = await User.findById(claims.sub);
    if (!user || user.tokenVersion !== claims.tv) throw unauthorized('Session expired, please log in again');
    if (!user.isActive) throw forbidden('Account is disabled');

    res.json({ user: user.toJSON(), tokens: deps.tokens.issuePair(tokenUser(user)) });
  });

  /** Revokes every access and refresh token issued to this user. */
  r.post('/logout', authenticate(deps.tokens), async (req, res) => {
    await User.updateOne({ _id: currentUser(req).id }, { $inc: { tokenVersion: 1 } });
    res.status(204).end();
  });

  r.get('/me', authenticate(deps.tokens), async (req, res) => {
    const user = await User.findById(currentUser(req).id);
    if (!user) throw unauthorized();
    res.json(user.toJSON());
  });

  return r;
}
