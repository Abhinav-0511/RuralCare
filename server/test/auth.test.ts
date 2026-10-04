import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Patient } from '../src/models/patient';
import { User } from '../src/models/user';
import { bearer, buildWorld, makeApp, PASSWORD, testEnv, useTestDb, type World } from './helpers';

useTestDb();
const app = makeApp();
let world: World;
beforeEach(async () => {
  world = await buildWorld();
});

const registration = () => ({
  name: 'Kaveri Natarajan',
  phone: '+91 98765 43210',
  password: 'Secret@123',
  sex: 'female',
  dateOfBirth: '1995-03-10',
  villageId: world.villages.v1.id,
  preferredLanguage: 'ta',
});

describe('POST /api/auth/register', () => {
  it('creates a patient account linked to a patient record and returns tokens', async () => {
    const res = await request(app).post('/api/auth/register').send(registration());

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'patient', phone: '9876543210', preferredLanguage: 'ta' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.tokens.accessToken).toEqual(expect.any(String));

    const patient = await Patient.findById(res.body.user.patientId);
    expect(patient).toMatchObject({ name: 'Kaveri Natarajan', sex: 'female' });
    expect(String(patient!.userId)).toBe(res.body.user.id);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.user.id);
  });

  it('rejects a phone number that is already registered', async () => {
    await request(app).post('/api/auth/register').send(registration()).expect(201);
    const res = await request(app).post('/api/auth/register').send(registration());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_TAKEN');
  });

  it('rejects an unknown village', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...registration(), villageId: '665f1c2e8b3e4a0012345678' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_VILLAGE');
  });

  it('validates phone, password and date of birth', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...registration(), phone: '12345', password: 'short', dateOfBirth: '2999-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'dateOfBirth',
      'password',
      'phone',
    ]);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with a normalised phone number', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: '+91 90000 00011', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('health_worker');
    expect(res.body.tokens.refreshToken).toEqual(expect.any(String));
  });

  it('returns the same 401 for a wrong password and an unknown phone', async () => {
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ phone: '9000000011', password: 'nope-nope' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ phone: '9111111111', password: PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('refuses disabled accounts', async () => {
    await User.updateOne({ _id: world.users.hw1._id }, { isActive: false });
    const res = await request(app).post('/api/auth/login').send({ phone: '9000000011', password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('access tokens', () => {
  it('requires a bearer token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt')).status).toBe(
      401,
    );
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { role: 'admin', tv: 0, typ: 'access', exp: Math.floor(Date.now() / 1000) - 10 },
      testEnv.JWT_ACCESS_SECRET,
      { subject: world.users.admin.id },
    );
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = jwt.sign({ role: 'admin', tv: 0, typ: 'access' }, 'x'.repeat(40), {
      subject: world.users.admin.id,
    });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(
      401,
    );
  });

  it('does not accept a refresh token as an access token', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: '9000000002', password: PASSWORD });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.tokens.refreshToken}`);
    expect(res.status).toBe(401);
  });

  it('blocks a deactivated user immediately, even with a valid token', async () => {
    const token = bearer(world.users.doctor);
    await User.updateOne({ _id: world.users.doctor._id }, { isActive: false });
    expect((await request(app).get('/api/auth/me').set('Authorization', token)).status).toBe(403);
  });
});

describe('refresh and logout', () => {
  it('issues a new token pair from a refresh token', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: '9000000002', password: PASSWORD });
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.tokens.refreshToken });
    expect(res.status).toBe(200);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('logout revokes both access and refresh tokens', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: '9000000002', password: PASSWORD });
    const { accessToken, refreshToken } = login.body.tokens;

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`).expect(204);

    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status,
    ).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(401);
  });

  it('an access token cannot be used as a refresh token', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: '9000000002', password: PASSWORD });
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.tokens.accessToken });
    expect(res.status).toBe(401);
  });
});
