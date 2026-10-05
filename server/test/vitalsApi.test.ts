import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Alert } from '../src/models/alert';
import {
  buildWorld,
  hasDocker,
  makeAppWithVitals,
  minutesAgo,
  useTestDb,
  useVitalsStore,
  type World,
} from './helpers';

useTestDb();
const store = useVitalsStore();

describe('vitals endpoints without TimescaleDB', () => {
  it('answer 503', async () => {
    const world = await buildWorld();
    const res = await request(makeAppWithVitals(null))
      .get(`/api/vitals/${world.patients.p1.id}`)
      .set('Authorization', world.auth.doctor);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('VITALS_UNAVAILABLE');
  });
});

describe.skipIf(!hasDocker())('GET /api/vitals/:patientId', () => {
  let world: World;
  let app: ReturnType<typeof makeAppWithVitals>;

  beforeEach(async () => {
    world = await buildWorld();
    app = makeAppWithVitals(store());
    for (const [m, spo2, hr] of [
      [20, 96, 70],
      [10, 94, 80],
      [3, 89, 110],
    ] as const) {
      await store().insert({
        time: minutesAgo(m),
        patientId: world.patients.p1.id,
        deviceId: 'rc-dev-01',
        spo2,
        heartRate: hr,
      });
    }
  });

  const get = (path: string, auth: string) => request(app).get(path).set('Authorization', auth);

  it('returns time_bucket averages for the range', async () => {
    const res = await get(
      `/api/vitals/${world.patients.p1.id}?from=${minutesAgo(60).toISOString()}&bucket=1h`,
      world.auth.hw1,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bucket: '1h', source: 'vitals_hourly' });
    const total = res.body.points.reduce((n: number, p: { readings: number }) => n + p.readings, 0);
    expect(total).toBe(3);
  });

  it('picks a bucket automatically and reads raw data for short ranges', async () => {
    const res = await get(
      `/api/vitals/${world.patients.p1.id}?from=${minutesAgo(30).toISOString()}`,
      world.auth.doctor,
    );
    expect(res.body).toMatchObject({ bucket: '1m', source: 'vitals' });
    expect(res.body.points).toHaveLength(3);
  });

  it('latest returns the newest values and the alerts they raise', async () => {
    const res = await get(`/api/vitals/${world.patients.p1.id}/latest`, world.auth.patient);
    expect(res.status).toBe(200);
    expect(res.body.vitals).toEqual({ spo2: 89, heartRate: 110 });
    expect(res.body.alerts.map((a: { code: string }) => a.code)).toEqual(['SPO2_CRITICAL']);
  });

  it('applies the same access rules as patients', async () => {
    expect((await get(`/api/vitals/${world.patients.p1.id}`, world.auth.hw2)).status).toBe(403);
    expect((await get(`/api/vitals/${world.patients.p2.id}`, world.auth.patient)).status).toBe(403);
    expect((await get(`/api/vitals/${world.patients.p1.id}`, world.auth.patient)).status).toBe(200);
  });

  it('validates the range and bucket', async () => {
    const id = world.patients.p1.id;
    expect((await get(`/api/vitals/${id}?bucket=2m`, world.auth.doctor)).status).toBe(400);
    const tooMany = await get(`/api/vitals/${id}?from=2026-01-01T00:00:00Z&bucket=1m`, world.auth.doctor);
    expect(tooMany.body.error.code).toBe('TOO_MANY_POINTS');
  });
});

describe('alerts', () => {
  let world: World;
  const app = makeAppWithVitals(null);

  const alert = (patient: 'p1' | 'p2', code: string, extra: object = {}) =>
    Alert.create({
      patientId: world.patients[patient]._id,
      villageId: world.patients[patient].villageId,
      deviceId: 'rc-dev-01',
      code,
      severity: code.includes('CRITICAL') ? 'critical' : 'warning',
      vital: 'spo2',
      value: 88,
      threshold: 90,
      firstSeenAt: minutesAgo(5),
      lastSeenAt: minutesAgo(1),
      ...extra,
    });

  beforeEach(async () => {
    world = await buildWorld();
  });

  it('GET lists alerts in scope with patient names and translated labels', async () => {
    await alert('p1', 'SPO2_CRITICAL');
    await alert('p2', 'TEMP_HIGH');
    const hw1 = await request(app).get('/api/alerts').set('Authorization', world.auth.hw1);
    expect(hw1.body.total).toBe(1);
    expect(hw1.body.items[0]).toMatchObject({
      code: 'SPO2_CRITICAL',
      patientName: 'Patient One',
      label: { en: 'Very low oxygen level' },
    });

    const doctor = await request(app)
      .get('/api/alerts?acknowledged=false')
      .set('Authorization', world.auth.doctor);
    expect(doctor.body.total).toBe(2);
    const patient = await request(app).get('/api/alerts').set('Authorization', world.auth.patient);
    expect(patient.body.items.map((a: { code: string }) => a.code)).toEqual(['SPO2_CRITICAL']);
  });

  it('PATCH acknowledges an alert (health worker of the village)', async () => {
    const a = await alert('p1', 'SPO2_CRITICAL');
    const res = await request(app)
      .patch(`/api/alerts/${a.id}`)
      .set('Authorization', world.auth.hw1)
      .send({ acknowledged: true, note: 'Visited, oxygen arranged' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      acknowledged: true,
      acknowledgedBy: world.users.hw1.id,
      acknowledgeNote: 'Visited, oxygen arranged',
    });

    const again = await request(app)
      .patch(`/api/alerts/${a.id}`)
      .set('Authorization', world.auth.doctor)
      .send({ acknowledged: true });
    expect(again.status).toBe(409);
  });

  it.each(['hw2', 'patient', 'admin'] as const)('%s cannot acknowledge a village-1 alert', async (who) => {
    const a = await alert('p1', 'SPO2_CRITICAL');
    const res = await request(app)
      .patch(`/api/alerts/${a.id}`)
      .set('Authorization', world.auth[who])
      .send({ acknowledged: true });
    expect(res.status).toBe(403);
  });

  it('only accepts acknowledged: true', async () => {
    const a = await alert('p1', 'SPO2_CRITICAL');
    const res = await request(app)
      .patch(`/api/alerts/${a.id}`)
      .set('Authorization', world.auth.doctor)
      .send({ acknowledged: false });
    expect(res.status).toBe(400);
  });
});
