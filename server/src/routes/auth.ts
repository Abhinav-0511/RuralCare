import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { Env } from '../config/env';
import { badRequest, forbidden, HttpError, unauthorized } from '../lib/httpError';
import { generateOtp } from '../lib/passwords';
import { rateLimit } from '../lib/rateLimit';
import type { TokenService } from '../lib/tokens';
import { authenticate, currentUser } from '../middleware/auth';
import { PasswordReset } from '../models/passwordReset';
import { User } from '../models/user';
import {
  ChangePasswordBodySchema,
  LoginBodySchema,
  OtpConfirmBodySchema,
  OtpRequestBodySchema,
  RefreshBodySchema,
} from '../schemas/api';
import type { SmsSender } from '../services/sms';

const tokenUser = (u: {
  id: string;
  role: 'patient' | 'health_worker' | 'doctor' | 'admin';
  tokenVersion: number;
}) => ({
  id: u.id,
  role: u.role,
  tokenVersion: u.tokenVersion,
});

export interface OnboardingConfig {
  /** Return the OTP in the response (development only). */
  otpDevEcho: boolean;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpRequestsPerPhonePerHour: number;
  /** Per IP, for the password-reset endpoints. */
  authRateLimitPer15Min: number;
  guestTriageRateLimitPer10Min: number;
}

const OTP_SENT = 'If this number has an account, a code has been sent to it.';
const invalidOtp = () => badRequest('INVALID_OTP', 'The code is wrong or has expired');

export function authRouter(deps: {
  tokens: TokenService;
  env: Pick<Env, 'BCRYPT_ROUNDS' | 'JWT_REFRESH_SECRET'>;
  config: OnboardingConfig;
  sms: SmsSender;
}) {
  const r = Router();
  const { config } = deps;
  // Compared against when the phone is unknown, so response time doesn't reveal which numbers exist.
  const dummyHash = bcrypt.hash('not-a-real-password', deps.env.BCRYPT_ROUNDS);
  const hashOtp = (otp: string, phone: string) =>
    createHmac('sha256', `otp:${deps.env.JWT_REFRESH_SECRET}`).update(`${phone}:${otp}`).digest('hex');
  const resetLimiter = rateLimit({ windowMs: 15 * 60_000, max: config.authRateLimitPer15Min });

  /**
   * Self-registration is disabled: patient accounts are created by health workers
   * (POST /api/patients with createLogin) and staff accounts by an admin (POST /api/users).
   */
  r.post('/register', () => {
    throw new HttpError(
      410,
      'SELF_REGISTRATION_DISABLED',
      'Self-registration is not available. Ask your village health worker to register you.',
    );
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

  const allowPending = authenticate(deps.tokens, { allowPendingPasswordChange: true });

  /** Revokes every access and refresh token issued to this user. */
  r.post('/logout', allowPending, async (req, res) => {
    await User.updateOne({ _id: currentUser(req).id }, { $inc: { tokenVersion: 1 } });
    res.status(204).end();
  });

  r.get('/me', allowPending, async (req, res) => {
    const user = await User.findById(currentUser(req).id);
    if (!user) throw unauthorized();
    res.json(user.toJSON());
  });

  /** Sets a new password (required after a temporary one). Other sessions are signed out. */
  r.post('/change-password', allowPending, async (req, res) => {
    const body = ChangePasswordBodySchema.parse(req.body);
    const user = await User.findById(currentUser(req).id).select('+passwordHash');
    if (!user) throw unauthorized();
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'The current password is wrong');
    }
    user.passwordHash = await bcrypt.hash(body.newPassword, deps.env.BCRYPT_ROUNDS);
    user.mustChangePassword = false;
    user.tokenVersion += 1;
    await user.save();
    res.json({ user: user.toJSON(), tokens: deps.tokens.issuePair(tokenUser(user)) });
  });

  /**
   * Forgot password, step 1. Always the same answer, whether or not the phone has an account.
   * A record is stored either way so the per-phone limit applies to unknown numbers too.
   */
  r.post('/password-reset/request', resetLimiter, async (req, res) => {
    const { phone } = OtpRequestBodySchema.parse(req.body);
    const now = Date.now();
    const recent = await PasswordReset.countDocuments({
      phone,
      createdAt: { $gte: new Date(now - 60 * 60_000) },
    });
    if (recent >= config.otpRequestsPerPhonePerHour) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many codes requested for this number, try again later');
    }

    const user = await User.findOne({ phone, isActive: true });
    const otp = generateOtp();
    // A new code replaces any earlier one.
    await PasswordReset.updateMany({ phone, closedAt: null }, { closedAt: new Date(now) });
    await PasswordReset.create({
      phone,
      userId: user?._id ?? null,
      codeHash: hashOtp(otp, phone),
      expiresAt: new Date(now + config.otpTtlSeconds * 1000),
      purgeAt: new Date(now + 24 * 3600_000),
    });
    if (user) {
      // Not awaited: a slow SMS gateway must not make answers for real accounts measurably slower.
      void deps.sms
        .send(
          phone,
          `RuralCare password reset code: ${otp}. Valid for ${Math.round(config.otpTtlSeconds / 60)} minutes. Do not share it.`,
        )
        .catch((err) => console.error('SMS send failed', err));
    }
    res.status(202).json({
      message: OTP_SENT,
      expiresInSeconds: config.otpTtlSeconds,
      ...(config.otpDevEcho ? { devOtp: otp } : {}),
    });
  });

  /** Forgot password, step 2. On success every existing session of the user is revoked. */
  r.post('/password-reset/confirm', resetLimiter, async (req, res) => {
    const body = OtpConfirmBodySchema.parse(req.body);
    const reset = await PasswordReset.findOne({ phone: body.phone, closedAt: null }).sort({ createdAt: -1 });
    if (!reset || reset.expiresAt.getTime() <= Date.now()) throw invalidOtp();

    // Count the attempt first, atomically, so parallel guesses can't exceed the limit.
    const counted = await PasswordReset.findOneAndUpdate(
      { _id: reset._id, closedAt: null, attempts: { $lt: config.otpMaxAttempts } },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    if (!counted) throw invalidOtp();

    const given = Buffer.from(hashOtp(body.otp, body.phone), 'hex');
    const expected = Buffer.from(counted.codeHash, 'hex');
    const matches = given.length === expected.length && timingSafeEqual(given, expected);
    if (!matches || !counted.userId) {
      if (counted.attempts >= config.otpMaxAttempts) {
        await PasswordReset.updateOne({ _id: counted._id }, { closedAt: new Date() });
      }
      throw invalidOtp();
    }

    const closed = await PasswordReset.updateOne(
      { _id: counted._id, closedAt: null },
      { closedAt: new Date() },
    );
    if (closed.modifiedCount !== 1) throw invalidOtp(); // used by a parallel request

    const user = await User.findById(counted.userId);
    if (!user || !user.isActive) throw invalidOtp();
    user.passwordHash = await bcrypt.hash(body.newPassword, deps.env.BCRYPT_ROUNDS);
    user.mustChangePassword = false;
    user.tokenVersion += 1; // signs out every device
    await user.save();
    res.json({ message: 'Password changed. Please log in with your new password.' });
  });

  return r;
}
