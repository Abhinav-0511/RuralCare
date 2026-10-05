import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { TriageSession } from '../src/models/triageSession';
import {
  adultInput,
  buildWorld,
  fakeAi,
  makeApp,
  modelSays,
  testEnv,
  useTestDb,
  type World,
} from './helpers';

useTestDb();
let world: World;
beforeEach(async () => {
  world = await buildWorld();
});

/** Document count of every collection, to prove a request wrote nothing. */
async function snapshot() {
  const counts: Record<string, number> = {};
  for (const [name, c] of Object.entries(mongoose.connection.collections))
    counts[name] = await c.countDocuments();
  return counts;
}

describe('POST /api/guest/triage (no account)', () => {
  it('needs no login and stores nothing on the server', async () => {
    const ai = fakeAi(modelSays('SELF_CARE'));
    const before = await snapshot();
    const res = await request(makeApp(ai))
      .post('/api/guest/triage')
      .send({ input: adultInput(['runny_nose', 'cough']) });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stored: false, result: { level: 'SELF_CARE', source: 'model' } });
    expect(res.body.guidance.disclaimer.en).toContain('not a medical diagnosis');
    expect(res.body.session).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ai.calls).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
  });

  it('red flags give EMERGENCY from the rules without calling the model, and store nothing', async () => {
    const ai = fakeAi(modelSays('SELF_CARE'));
    const before = await snapshot();
    const res = await request(makeApp(ai))
      .post('/api/guest/triage')
      .send({ input: adultInput(['chest_pain']) });
    expect(res.body.result).toMatchObject({ level: 'EMERGENCY', source: 'rule_engine' });
    expect(ai.calls).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
  });

  it('applies the same safety floors and model-unavailable fallback as /api/triage', async () => {
    const app = makeApp(fakeAi(modelSays('SELF_CARE')));
    const guest = await request(app)
      .post('/api/guest/triage')
      .send({ input: adultInput(['runny_nose'], { severity: 'severe' }) });
    const staff = await request(app)
      .post('/api/triage')
      .set('Authorization', world.auth.hw1)
      .send({ patientId: world.patients.p1.id, input: adultInput(['runny_nose'], { severity: 'severe' }) });
    expect(guest.body.result.level).toBe('SEE_DOCTOR_24H');
    expect(guest.body.result).toMatchObject({
      level: staff.body.session.result.level,
      source: staff.body.session.result.source,
      safetyFloors: staff.body.session.result.safetyFloors,
    });

    const down = await request(makeApp()) // AI service down
      .post('/api/guest/triage')
      .send({ input: adultInput(['runny_nose']) });
    expect(down.body.result).toMatchObject({ level: 'SEE_DOCTOR_SOON', source: 'rule_engine_fallback' });
    expect(down.body.guidance.notice.en).toBeTruthy();
  });

  it('requires age, like every new triage', async () => {
    const res = await request(makeApp())
      .post('/api/guest/triage')
      .send({ input: { symptoms: ['cough'] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is rate-limited per client', async () => {
    const app = createApp({ env: testEnv, ai: fakeAi(), onboarding: { guestTriageRateLimitPer10Min: 2 } });
    const send = () =>
      request(app)
        .post('/api/guest/triage')
        .send({ input: adultInput(['cough']) });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/triage/guest-claims', () => {
  const claim = (clientId: string) => ({
    clientId,
    clientCreatedAt: new Date(Date.now() - 3600_000).toISOString(),
    input: adultInput(['chest_pain']),
    clientResult: { level: 'EMERGENCY', source: 'rule_engine', rulesVersion: '1.2.0' },
  });

  it("adds guest checks to the patient's own record, marked origin=guest, idempotently", async () => {
    const app = makeApp();
    const id = crypto.randomUUID();
    const res = await request(app)
      .post('/api/triage/guest-claims')
      .set('Authorization', world.auth.patient)
      .send({ sessions: [claim(id)] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ clientId: id, status: 'created', level: 'EMERGENCY' });

    const stored = await TriageSession.findOne({ clientId: id });
    expect(stored).toMatchObject({ origin: 'guest' });
    expect(String(stored!.patientId)).toBe(world.patients.p1.id);

    const again = await request(app)
      .post('/api/triage/guest-claims')
      .set('Authorization', world.auth.patient)
      .send({ sessions: [claim(id)] });
    expect(again.body.results[0].status).toBe('duplicate');
    expect(await TriageSession.countDocuments({ clientId: id })).toBe(1);
  });

  it('ignores any patientId in the body and is only for patients', async () => {
    const app = makeApp();
    const id = crypto.randomUUID();
    await request(app)
      .post('/api/triage/guest-claims')
      .set('Authorization', world.auth.patient)
      .send({ sessions: [{ ...claim(id), patientId: world.patients.p2.id }] })
      .expect(200);
    expect(String((await TriageSession.findOne({ clientId: id }))!.patientId)).toBe(world.patients.p1.id);

    for (const auth of [world.auth.hw1, world.auth.doctor, world.auth.admin]) {
      const res = await request(app)
        .post('/api/triage/guest-claims')
        .set('Authorization', auth)
        .send({ sessions: [claim(crypto.randomUUID())] });
      expect(res.status).toBe(403);
    }
    expect((await request(app).post('/api/triage/guest-claims').send({ sessions: [] })).status).toBe(401);
  });
});
