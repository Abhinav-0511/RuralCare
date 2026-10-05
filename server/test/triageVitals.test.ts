import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { VitalsStore } from '../src/vitals/store';
import {
  adultInput,
  buildWorld,
  fakeAi,
  hasDocker,
  makeAppWithVitals,
  minutesAgo,
  modelSays,
  useTestDb,
  useVitalsStore,
  type World,
} from './helpers';

useTestDb();
const store = useVitalsStore();

describe('triage without TimescaleDB access', () => {
  it('still works when reading recent vitals fails', async () => {
    const world = await buildWorld();
    const broken = {
      extremes: () => Promise.reject(new Error('connection refused')),
    } as unknown as VitalsStore;
    const res = await request(makeAppWithVitals(broken, fakeAi(modelSays('SELF_CARE'))))
      .post('/api/triage')
      .set('Authorization', world.auth.hw1)
      .send({ patientId: world.patients.p1.id, input: adultInput(['cough']) });
    expect(res.status).toBe(201);
    expect(res.body.session).toMatchObject({ vitalsSource: null, result: { level: 'SELF_CARE' } });
  });
});

describe.skipIf(!hasDocker())('recent device vitals in triage', () => {
  let world: World;
  const reading = (minutes: number, vitals: object) =>
    store().insert({
      time: minutesAgo(minutes),
      patientId: world.patients.p1.id,
      deviceId: 'rc-dev-01',
      ...vitals,
    });

  beforeEach(async () => {
    world = await buildWorld();
  });

  const triage = (ai = fakeAi(modelSays('SELF_CARE')), input: object = adultInput(['cough'])) =>
    request(makeAppWithVitals(store(), ai))
      .post('/api/triage')
      .set('Authorization', world.auth.hw1)
      .send({ patientId: world.patients.p1.id, input });

  it('critical SpO2 from the last 30 minutes escalates to EMERGENCY via the shared rules (model not called)', async () => {
    await reading(5, { spo2: 85, heartRate: 96 });
    const ai = fakeAi(modelSays('SELF_CARE'));
    const res = await triage(ai);

    expect(res.body.session.result).toMatchObject({
      level: 'EMERGENCY',
      source: 'rule_engine',
      redFlags: ['RF_LOW_OXYGEN'],
    });
    expect(res.body.session).toMatchObject({
      vitalsSource: 'device',
      input: { vitals: { spo2: 85, heartRate: 96 } },
    });
    expect(res.body.guidance.reasons[0].en).toMatch(/oxygen/i);
    expect(ai.calls).toHaveLength(0);
  });

  it('a brief critical reading is not hidden by later normal readings', async () => {
    await reading(12, { spo2: 97, heartRate: 80 });
    await reading(8, { spo2: 86, heartRate: 84 }); // critical
    await reading(1, { spo2: 98, heartRate: 78 }); // the latest is normal again
    const res = await triage();
    expect(res.body.session.result).toMatchObject({ level: 'EMERGENCY', redFlags: ['RF_LOW_OXYGEN'] });
    expect(res.body.session.input.vitals).toEqual({ spo2: 86, heartRate: 78 });
  });

  it('picks the worse extreme for heart rate (low or high)', async () => {
    await reading(10, { heartRate: 36 });
    await reading(2, { heartRate: 125 }); // warning-high is less severe than critical-low
    const res = await triage();
    expect(res.body.session.input.vitals.heartRate).toBe(36);
    expect(res.body.session.result.redFlags).toEqual(['RF_HEART_RATE_EXTREME']);
  });

  it('a device temperature of 41 °C is used when none was typed in', async () => {
    await reading(2, { temperatureC: 41.2 });
    const res = await triage();
    expect(res.body.session.result.redFlags).toEqual(['RF_VERY_HIGH_TEMPERATURE']);
    expect(res.body.session.input.temperatureC).toBe(41.2);
  });

  it('vitals older than 30 minutes are ignored', async () => {
    await reading(45, { spo2: 82 });
    const res = await triage();
    expect(res.body.session).toMatchObject({
      vitalsSource: null,
      result: { level: 'SELF_CARE', source: 'model' },
    });
  });

  it('normal recent vitals are attached and passed to the AI service without escalating', async () => {
    await reading(4, { spo2: 97, heartRate: 76, systolicBp: 124, diastolicBp: 82 });
    const ai = fakeAi(modelSays('SELF_CARE'));
    const res = await triage(ai);
    expect(res.body.session.result.level).toBe('SELF_CARE');
    expect(ai.calls[0]!.vitals).toEqual({ spo2: 97, heartRate: 76, systolicBp: 124, diastolicBp: 82 });
  });

  it('vitals typed in by the user take precedence over the device', async () => {
    await reading(3, { spo2: 97 });
    const res = await triage(fakeAi(modelSays('SELF_CARE')), adultInput(['cough'], { vitals: { spo2: 87 } }));
    expect(res.body.session).toMatchObject({ vitalsSource: 'manual', result: { level: 'EMERGENCY' } });
  });

  it('offline sync uses the vitals from the 30 minutes before the session was recorded', async () => {
    await reading(70, { spo2: 84 }); // 10 min before the offline session below
    const res = await request(makeAppWithVitals(store(), fakeAi(modelSays('SELF_CARE'))))
      .post('/api/triage/sync')
      .set('Authorization', world.auth.hw1)
      .send({
        sessions: [
          {
            clientId: randomUUID(),
            patientId: world.patients.p1.id,
            clientCreatedAt: minutesAgo(60).toISOString(),
            input: adultInput(['cough']),
          },
        ],
      });
    expect(res.body.results[0]).toMatchObject({ status: 'created', level: 'EMERGENCY' });
  });
});
