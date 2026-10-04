import { randomUUID } from 'node:crypto';
import type { TriageLevelId } from '@ruralcare/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { istBucketKeys } from '../src/lib/dates';
import { TriageSession } from '../src/models/triageSession';
import { buildWorld, makeApp, useTestDb, type World } from './helpers';

useTestDb();
const app = makeApp();
let world: World;

const FROM = '2026-09-01T00:00:00+05:30'; // a Tuesday
const TO = '2026-09-08T00:00:00+05:30';

async function insert(
  village: 'v1' | 'v2',
  level: TriageLevelId,
  occurredAt: string,
  extra: { reviewed?: boolean; fallback?: boolean } = {},
) {
  const patient = village === 'v1' ? world.patients.p1 : world.patients.p2;
  await TriageSession.create({
    clientId: randomUUID(),
    patientId: patient._id,
    villageId: patient.villageId,
    performedBy: world.users.admin._id,
    origin: 'online',
    occurredAt: new Date(occurredAt),
    input: { symptoms: ['cough'], ageMonths: 400 },
    result: {
      level,
      source: level === 'EMERGENCY' ? 'rule_engine' : extra.fallback ? 'rule_engine_fallback' : 'model',
      redFlags: [],
      safetyFloors: [],
      rulesVersion: 'test',
      model: { status: extra.fallback ? 'unavailable' : 'ok', topConditions: [] },
    },
    review: { status: extra.reviewed ? 'reviewed' : 'pending', notes: [] },
  });
}

beforeEach(async () => {
  world = await buildWorld();
  await insert('v1', 'EMERGENCY', '2026-09-02T10:00:00+05:30');
  await insert('v1', 'SELF_CARE', '2026-09-02T23:30:00+05:30', { reviewed: true }); // still 2 Sep in IST
  await insert('v1', 'SEE_DOCTOR_SOON', '2026-09-03T00:30:00+05:30', { fallback: true }); // 2 Sep in UTC, 3 Sep in IST
  await insert('v2', 'SEE_DOCTOR_24H', '2026-09-05T12:00:00+05:30');
  await insert('v2', 'SELF_CARE', '2026-09-07T18:00:00+05:30', { reviewed: true });
  await insert('v2', 'SELF_CARE', '2026-08-20T12:00:00+05:30'); // outside the range
});

const stats = (auth: string, query: Record<string, string>) =>
  request(app).get('/api/dashboard/stats').query(query).set('Authorization', auth);

describe('GET /api/dashboard/stats', () => {
  it('counts by level, village and day (IST buckets, zero-filled)', async () => {
    const res = await stats(world.auth.doctor, { from: FROM, to: TO });
    expect(res.status).toBe(200);
    const body = res.body;

    expect(body.total).toBe(5);
    expect(body.byLevel).toEqual({ EMERGENCY: 1, SEE_DOCTOR_24H: 1, SEE_DOCTOR_SOON: 1, SELF_CARE: 2 });
    expect(body.pendingReview).toBe(3);
    expect(body.modelUnavailable).toBe(1);

    expect(body.byVillage).toEqual([
      expect.objectContaining({ villageName: 'Kelambakkam', total: 3 }),
      expect.objectContaining({ villageName: 'Ponneri', total: 2 }),
    ]);
    expect(body.byVillage[0].byLevel).toEqual({
      EMERGENCY: 1,
      SEE_DOCTOR_24H: 0,
      SEE_DOCTOR_SOON: 1,
      SELF_CARE: 1,
    });

    const days = Object.fromEntries(
      body.overTime.map((b: { date: string; total: number }) => [b.date, b.total]),
    );
    expect(days).toEqual({
      '2026-09-01': 0,
      '2026-09-02': 2,
      '2026-09-03': 1,
      '2026-09-04': 0,
      '2026-09-05': 1,
      '2026-09-06': 0,
      '2026-09-07': 1,
    });
  });

  it('groups by Monday-based weeks', async () => {
    const res = await stats(world.auth.admin, { from: FROM, to: TO, interval: 'week' });
    expect(res.body.overTime.map((b: { date: string; total: number }) => [b.date, b.total])).toEqual([
      ['2026-08-31', 4],
      ['2026-09-07', 1],
    ]);
  });

  it('health workers only see their own villages', async () => {
    const res = await stats(world.auth.hw2, { from: FROM, to: TO });
    expect(res.body.total).toBe(2);
    expect(res.body.byVillage.map((v: { villageName: string }) => v.villageName)).toEqual(['Ponneri']);
    expect(res.body.byLevel.EMERGENCY).toBe(0);
  });

  it('filters by village', async () => {
    const res = await stats(world.auth.doctor, { from: FROM, to: TO, villageId: world.villages.v1.id });
    expect(res.body.total).toBe(3);
    expect(res.body.byVillage).toHaveLength(1);
  });

  it('defaults to the last 30 days', async () => {
    const res = await stats(world.auth.doctor, {});
    expect(res.status).toBe(200);
    expect(res.body.overTime.length).toBeGreaterThanOrEqual(30);
  });

  it('validates the range', async () => {
    expect((await stats(world.auth.doctor, { from: TO, to: FROM })).body.error.code).toBe('INVALID_RANGE');
    expect(
      (await stats(world.auth.doctor, { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })).body
        .error.code,
    ).toBe('RANGE_TOO_LARGE');
    expect((await stats(world.auth.doctor, { interval: 'month' })).status).toBe(400);
  });
});

describe('IST bucket helper', () => {
  it('generates day and week keys', () => {
    expect(istBucketKeys(new Date(FROM), new Date(TO), 'day')).toHaveLength(7);
    expect(istBucketKeys(new Date(FROM), new Date(TO), 'week')).toEqual(['2026-08-31', '2026-09-07']);
  });
});
