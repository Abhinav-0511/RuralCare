import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PasswordReset } from '../src/models/passwordReset';
import { User } from '../src/models/user';
import type { SmsSender } from '../src/services/sms';
import { buildWorld, fakeAi, PASSWORD, testEnv, useTestDb, type World } from './helpers';

useTestDb();
let world: World;
let sent: { phone: string; text: string }[];

const capturingSms = (): SmsSender => ({
  async send(phone, text) {
    sent.push({ phone, text });
  },
});
const makeResetApp = (onboarding: Parameters<typeof createApp>[0]['onboarding'] = {}) =>
  createApp({ env: testEnv, ai: fakeAi(), sms: capturingSms(), onboarding });

beforeEach(async () => {
  world = await buildWorld();
  sent = [];
});

const KNOWN = '9000000021'; // patient login
const UNKNOWN = '9111111111';
const otpFrom = (text: string) => text.match(/\b(\d{6})\b/)![1]!;
const requestOtp = (app: ReturnType<typeof makeResetApp>, phone: string) =>
  request(app).post('/api/auth/password-reset/request').send({ phone });
const confirm = (
  app: ReturnType<typeof makeResetApp>,
  phone: string,
  otp: string,
  newPassword = 'Fresh@Pass1',
) => request(app).post('/api/auth/password-reset/confirm').send({ phone, otp, newPassword });
const flush = () => new Promise((r) => setImmediate(r)); // the SMS is sent without awaiting

describe('forgot password with an SMS code', () => {
  it('sends a code to a real account, and the code resets the password and revokes all sessions', async () => {
    const app = makeResetApp();
    const oldAuth = world.auth.patient;
    const res = await requestOtp(app, KNOWN);
    expect(res.status).toBe(202);
    expect(res.body.devOtp).toBeUndefined(); // only echoed when OTP_DEV_ECHO is on
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.phone).toBe(KNOWN);

    const ok = await confirm(app, KNOWN, otpFrom(sent[0]!.text));
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', oldAuth)).status).toBe(401);
    const loginOld = await request(app).post('/api/auth/login').send({ phone: KNOWN, password: PASSWORD });
    expect(loginOld.status).toBe(401);
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ phone: KNOWN, password: 'Fresh@Pass1' });
    expect(loginNew.status).toBe(200);

    // single use
    expect((await confirm(app, KNOWN, otpFrom(sent[0]!.text), 'Other@Pass2')).body.error.code).toBe(
      'INVALID_OTP',
    );
  });

  it('also clears a pending temporary password', async () => {
    await User.updateOne({ phone: KNOWN }, { mustChangePassword: true });
    const app = makeResetApp();
    await requestOtp(app, KNOWN);
    await flush();
    await confirm(app, KNOWN, otpFrom(sent[0]!.text)).expect(200);
    expect((await User.findOne({ phone: KNOWN }))!.mustChangePassword).toBe(false);
  });

  it('does not reveal whether a phone number has an account', async () => {
    const app = makeResetApp({ otpDevEcho: true });
    const known = await requestOtp(app, KNOWN);
    const unknown = await requestOtp(app, UNKNOWN);
    expect(unknown.status).toBe(known.status);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());
    expect(unknown.body.message).toBe(known.body.message);
    expect(unknown.body.devOtp).toMatch(/^\d{6}$/); // even in dev mode, unknown numbers get a code
    await flush();
    expect(sent.map((s) => s.phone)).toEqual([KNOWN]); // but only real accounts get an SMS

    // and confirming fails the same way for both
    const badKnown = await confirm(app, KNOWN, '000000');
    const badUnknown = await confirm(app, UNKNOWN, unknown.body.devOtp);
    expect(badUnknown.status).toBe(400);
    expect(badUnknown.body).toEqual({ ...badKnown.body });
    expect(badUnknown.body.error.code).toBe('INVALID_OTP');
  });

  it('codes expire (5 minutes by default)', async () => {
    const app = makeResetApp({ otpDevEcho: true });
    const res = await requestOtp(app, KNOWN);
    expect(res.body.expiresInSeconds).toBe(300);
    const doc = await PasswordReset.findOne({ phone: KNOWN });
    expect(Math.abs(doc!.expiresAt.getTime() - doc!.get('createdAt').getTime() - 300_000)).toBeLessThan(1000);

    await PasswordReset.updateOne({ _id: doc!._id }, { expiresAt: new Date(Date.now() - 1000) });
    const late = await confirm(app, KNOWN, res.body.devOtp);
    expect(late.body.error.code).toBe('INVALID_OTP');
    expect(
      (await request(app).post('/api/auth/login').send({ phone: KNOWN, password: PASSWORD })).status,
    ).toBe(200);
  });

  it('a code allows only a few attempts, then even the right code fails', async () => {
    const app = makeResetApp({ otpDevEcho: true, otpMaxAttempts: 3 });
    const { devOtp } = (await requestOtp(app, KNOWN)).body;
    const wrong = devOtp === '123456' ? '654321' : '123456';
    for (let i = 0; i < 3; i++)
      expect((await confirm(app, KNOWN, wrong)).body.error.code).toBe('INVALID_OTP');
    expect((await confirm(app, KNOWN, devOtp)).body.error.code).toBe('INVALID_OTP');
    expect(
      (await request(app).post('/api/auth/login').send({ phone: KNOWN, password: PASSWORD })).status,
    ).toBe(200);
  });

  it('a new code replaces the previous one', async () => {
    const app = makeResetApp({ otpDevEcho: true });
    const first = (await requestOtp(app, KNOWN)).body.devOtp;
    const second = (await requestOtp(app, KNOWN)).body.devOtp;
    if (first !== second) expect((await confirm(app, KNOWN, first)).body.error.code).toBe('INVALID_OTP');
    expect((await confirm(app, KNOWN, second)).status).toBe(200);
  });

  it('limits code requests per phone, identically for unknown numbers', async () => {
    const app = makeResetApp({ otpRequestsPerPhonePerHour: 2 });
    for (const phone of [KNOWN, UNKNOWN]) {
      expect((await requestOtp(app, phone)).status).toBe(202);
      expect((await requestOtp(app, phone)).status).toBe(202);
      const limited = await requestOtp(app, phone);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
    }
    await flush();
    expect(sent).toHaveLength(2);
  });

  it('limits requests and attempts per client IP across phone numbers', async () => {
    const app = makeResetApp({ authRateLimitPer15Min: 3, otpRequestsPerPhonePerHour: 10 });
    for (let i = 0; i < 3; i++) expect((await requestOtp(app, `91111111${10 + i}`)).status).toBe(202);
    expect((await requestOtp(app, '9111111120')).status).toBe(429);
  });

  it('never stores the code itself', async () => {
    const app = makeResetApp({ otpDevEcho: true });
    const { devOtp } = (await requestOtp(app, KNOWN)).body;
    const raw = JSON.stringify(await PasswordReset.find().lean());
    expect(raw).not.toContain(`"${devOtp}"`);
  });

  it('a disabled account cannot be reset', async () => {
    await User.updateOne({ phone: KNOWN }, { isActive: false });
    const app = makeResetApp({ otpDevEcho: true });
    const { devOtp } = (await requestOtp(app, KNOWN)).body;
    await flush();
    expect(sent).toHaveLength(0);
    expect((await confirm(app, KNOWN, devOtp)).body.error.code).toBe('INVALID_OTP');
  });
});
