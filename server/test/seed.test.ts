import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { Patient } from '../src/models/patient';
import { TriageSession } from '../src/models/triageSession';
import { User } from '../src/models/user';
import { ensureAdmin } from '../src/services/bootstrap';
import { DEMO_PASSWORD, seedDemoData } from '../src/services/seed';
import { makeApp, testEnv, useTestDb } from './helpers';

useTestDb();
const app = makeApp();

describe('seedDemoData', () => {
  it('creates villages, staff, patients and sessions that dashboards can use', async () => {
    const summary = await seedDemoData({ bcryptRounds: 4, sessionCount: 60 });
    expect(summary).toMatchObject({ villages: 6, patients: 18, sessions: 60 });
    expect(await User.countDocuments({ role: 'health_worker' })).toBe(3);
    expect(await User.countDocuments({ role: 'doctor' })).toBe(2);
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);

    // Every seeded session respects the safety rules.
    const sessions = await TriageSession.find();
    for (const s of sessions) {
      expect(s.result.level === 'EMERGENCY').toBe(s.result.source === 'rule_engine');
      if (s.result.source === 'rule_engine_fallback') expect(s.result.level).not.toBe('SELF_CARE');
    }
    expect(sessions.some((s) => s.result.level === 'EMERGENCY')).toBe(true);
    expect(sessions.some((s) => s.review.status === 'reviewed')).toBe(true);

    // The patient login is linked both ways.
    const patientUser = await User.findOne({ role: 'patient' });
    const patient = await Patient.findById(patientUser!.patientId);
    expect(String(patient!.userId)).toBe(patientUser!.id);

    // Demo credentials work and the dashboard has data.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: '9000000002', password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    const stats = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`);
    expect(stats.body.total).toBeGreaterThan(40);
    expect(stats.body.byVillage).toHaveLength(6);
  });

  it('is repeatable (wipes before seeding)', async () => {
    await seedDemoData({ bcryptRounds: 4, sessionCount: 10 });
    await seedDemoData({ bcryptRounds: 4, sessionCount: 10 });
    expect(await TriageSession.countDocuments()).toBe(10);
    expect(await User.countDocuments()).toBe(7);
  });
});

describe('ensureAdmin', () => {
  const env = loadEnv({
    MONGO_URI: 'mongodb://unused',
    JWT_ACCESS_SECRET: testEnv.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: testEnv.JWT_REFRESH_SECRET,
    BCRYPT_ROUNDS: '4',
    SEED_ADMIN_PHONE: '+91 90000 00999',
    SEED_ADMIN_PASSWORD: 'Admin@12345',
  });

  it('creates the first admin only once', async () => {
    expect(await ensureAdmin(env)).toBe(true);
    expect(await ensureAdmin(env)).toBe(false);
    expect(await User.findOne({ role: 'admin' })).toMatchObject({
      phone: '9000000999',
      name: 'RuralCare Admin',
    });
  });
});
