import { randomUUID } from 'node:crypto';
import type { ModelOutcome, NonEmergencyLevelId, TriageContext } from '@ruralcare/shared';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { type AppDeps, createApp } from '../src/app';
import { connectDb } from '../src/db';
import { createTokenService } from '../src/lib/tokens';
import { Patient } from '../src/models/patient';
import { type Role, User } from '../src/models/user';
import { Village } from '../src/models/village';
import type { AiClient } from '../src/services/aiClient';
import { VitalsStore } from '../src/vitals/store';

export const testEnv = {
  NODE_ENV: 'test',
  CORS_ORIGIN: ['http://localhost:5173'],
  BCRYPT_ROUNDS: 4,
  JWT_ACCESS_SECRET: 'test_access_secret_0123456789abcdef0123456789',
  JWT_REFRESH_SECRET: 'test_refresh_secret_0123456789abcdef012345678',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
} satisfies AppDeps['env'];

export const tokens = createTokenService(testEnv);
export const PASSWORD = 'Password@123';

/** Connects this test file to its own database and empties it before every test. */
export function useTestDb() {
  beforeAll(async () => {
    await connectDb(inject('mongoUri'), `test_${randomUUID().slice(0, 8)}`);
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });
}

export const AI_DOWN: ModelOutcome = { status: 'unavailable', reason: 'AI service unreachable' };

export const modelSays = (level: NonEmergencyLevelId): ModelOutcome => ({
  status: 'ok',
  prediction: {
    level,
    confidence: 0.87,
    modelVersion: 'test-model-1',
    topConditions: [{ id: 'common_cold', probability: 0.87 }],
  },
});

export type FakeAi = AiClient & { calls: TriageContext[] };

export const TEST_MODEL_VERSION = {
  modelVersion: 'test-model-1',
  algorithm: 'Logistic Regression',
  createdAt: '2026-10-04T00:00:00Z',
  sha256: 'a'.repeat(64),
  sizeBytes: 27000,
  featureCount: 131,
  classCount: 41,
};

/** Records every predict() call so tests can assert the model was (not) consulted. */
export function fakeAi(
  behaviour: ModelOutcome | ((input: TriageContext) => ModelOutcome | Promise<ModelOutcome>) = AI_DOWN,
  healthy = false,
): FakeAi {
  const calls: TriageContext[] = [];
  return {
    calls,
    async predict(input) {
      calls.push(input);
      return typeof behaviour === 'function' ? behaviour(input) : behaviour;
    },
    async isHealthy() {
      return healthy;
    },
    async modelVersion() {
      return healthy ? TEST_MODEL_VERSION : null;
    },
  };
}

export const makeApp = (ai: AiClient = fakeAi()) => createApp({ env: testEnv, ai });

export const bearer = (u: { id: string; role: Role; tokenVersion: number }) =>
  `Bearer ${tokens.issuePair({ id: u.id, role: u.role, tokenVersion: u.tokenVersion }).accessToken}`;

/**
 * Two villages, each with a health worker and a patient; plus an admin, a doctor and a patient
 * login linked to patient p1 (village v1).
 */
export async function buildWorld() {
  const [v1, v2] = await Village.insertMany([
    { name: 'Kelambakkam', district: 'Chengalpattu' },
    { name: 'Ponneri', district: 'Tiruvallur' },
  ]);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const mk = (name: string, phone: string, role: Role, extra: Record<string, unknown> = {}) =>
    User.create({ name, phone, role, passwordHash, ...extra });

  const admin = await mk('Admin', '9000000001', 'admin');
  const doctor = await mk('Dr. Test', '9000000002', 'doctor');
  const hw1 = await mk('Health Worker One', '9000000011', 'health_worker', { villageIds: [v1!._id] });
  const hw2 = await mk('Health Worker Two', '9000000012', 'health_worker', { villageIds: [v2!._id] });
  const p1 = await Patient.create({
    name: 'Patient One',
    sex: 'female',
    dateOfBirth: new Date('1990-01-15'),
    villageId: v1!._id,
  });
  const p2 = await Patient.create({
    name: 'Patient Two',
    sex: 'male',
    dateOfBirth: new Date('1980-06-01'),
    villageId: v2!._id,
  });
  const patientUser = await mk('Patient One', '9000000021', 'patient', { patientId: p1._id });
  p1.userId = patientUser._id;
  await p1.save();

  return {
    villages: { v1: v1!, v2: v2! },
    patients: { p1, p2 },
    users: { admin, doctor, hw1, hw2, patientUser },
    auth: {
      admin: bearer(admin),
      doctor: bearer(doctor),
      hw1: bearer(hw1),
      hw2: bearer(hw2),
      patient: bearer(patientUser),
    },
  };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;

export const adultInput = (symptoms: string[], extra: Partial<TriageContext> = {}) => ({
  symptoms,
  ageMonths: 35 * 12,
  ...extra,
});

// ───────────── Vitals (TimescaleDB) ─────────────

/** True when globalSetup could start the TimescaleDB/Mosquitto containers. */
export const hasDocker = () => inject('tsdbUrl') !== '';

/** A VitalsStore on the shared test TimescaleDB, closed after the file. */
export function useVitalsStore() {
  let store: VitalsStore | null = null;
  beforeAll(() => {
    if (hasDocker()) store = VitalsStore.connect(inject('tsdbUrl'));
  });
  afterAll(async () => {
    await store?.close();
  });
  return () => {
    if (!store) throw new Error('TimescaleDB not available');
    return store;
  };
}

export const randomObjectId = () => new mongoose.Types.ObjectId().toString();

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

export const makeAppWithVitals = (store: VitalsStore | null, ai: AiClient = fakeAi()) =>
  createApp({ env: testEnv, ai, vitals: store });
