import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  adultInput,
  buildWorld,
  fakeAi,
  makeApp,
  modelSays,
  PASSWORD,
  useTestDb,
  type World,
} from './helpers';

useTestDb();
const app = makeApp(fakeAi(modelSays('SELF_CARE')));
let world: World;
beforeEach(async () => {
  world = await buildWorld();
});

const triage = (auth: string, body: object) =>
  request(app).post('/api/triage').set('Authorization', auth).send(body);

describe('admin-only user management', () => {
  it.each(['patient', 'hw1', 'doctor'] as const)('%s cannot list users', async (who) => {
    const res = await request(app).get('/api/users').set('Authorization', world.auth[who]);
    expect(res.status).toBe(403);
  });

  it('admin can list and create users', async () => {
    const list = await request(app).get('/api/users').set('Authorization', world.auth.admin);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(5);

    const created = await request(app)
      .post('/api/users')
      .set('Authorization', world.auth.admin)
      .send({
        name: 'New ASHA',
        phone: '9000000099',
        password: PASSWORD,
        role: 'health_worker',
        villageIds: [world.villages.v2.id],
      });
    expect(created.status).toBe(201);
    expect(created.body.villageIds).toEqual([world.villages.v2.id]);
  });

  it('changing a role revokes the old token', async () => {
    const oldToken = world.auth.hw1;
    await request(app)
      .patch(`/api/users/${world.users.hw1.id}`)
      .set('Authorization', world.auth.admin)
      .send({ role: 'doctor' })
      .expect(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', oldToken)).status).toBe(401);
  });

  it('admin cannot deactivate themselves', async () => {
    const res = await request(app)
      .patch(`/api/users/${world.users.admin.id}`)
      .set('Authorization', world.auth.admin)
      .send({ isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SELF_LOCKOUT');
  });
});

describe('villages', () => {
  it('listing is public; creating is admin-only', async () => {
    expect((await request(app).get('/api/villages')).body).toHaveLength(2);
    const body = { name: 'Uthiramerur', district: 'Kancheepuram' };
    expect(
      (await request(app).post('/api/villages').set('Authorization', world.auth.hw1).send(body)).status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/villages').set('Authorization', world.auth.admin).send(body)).status,
    ).toBe(201);
  });
});

describe('patient scope', () => {
  it('a patient can triage themselves (patientId defaults to their own record)', async () => {
    const res = await triage(world.auth.patient, { input: adultInput(['cough']) });
    expect(res.status).toBe(201);
    expect(res.body.session.patientId).toBe(world.patients.p1.id);
  });

  it('a patient cannot triage someone else', async () => {
    const res = await triage(world.auth.patient, {
      patientId: world.patients.p2.id,
      input: adultInput(['cough']),
    });
    expect(res.status).toBe(403);
  });

  it('a patient cannot read another patient record or list patients', async () => {
    const other = await request(app)
      .get(`/api/patients/${world.patients.p2.id}`)
      .set('Authorization', world.auth.patient);
    expect(other.status).toBe(403);
    const own = await request(app)
      .get(`/api/patients/${world.patients.p1.id}`)
      .set('Authorization', world.auth.patient);
    expect(own.status).toBe(200);
    expect((await request(app).get('/api/patients').set('Authorization', world.auth.patient)).status).toBe(
      403,
    );
  });

  it('a patient only sees their own sessions', async () => {
    await triage(world.auth.hw2, { patientId: world.patients.p2.id, input: adultInput(['cough']) }).expect(
      201,
    );
    await triage(world.auth.patient, { input: adultInput(['cough']) }).expect(201);
    const res = await request(app).get('/api/triage').set('Authorization', world.auth.patient);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].patientId).toBe(world.patients.p1.id);
  });
});

describe('health worker scope (assigned villages only)', () => {
  it('can triage a patient in their village but not in another', async () => {
    expect(
      (await triage(world.auth.hw1, { patientId: world.patients.p1.id, input: adultInput(['cough']) }))
        .status,
    ).toBe(201);
    expect(
      (await triage(world.auth.hw1, { patientId: world.patients.p2.id, input: adultInput(['cough']) }))
        .status,
    ).toBe(403);
  });

  it('lists only patients from their villages', async () => {
    const res = await request(app).get('/api/patients').set('Authorization', world.auth.hw1);
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([world.patients.p1.id]);
    const forbidden = await request(app)
      .get(`/api/patients?villageId=${world.villages.v2.id}`)
      .set('Authorization', world.auth.hw1);
    expect(forbidden.status).toBe(403);
  });

  it('cannot register a patient in another village', async () => {
    const res = await request(app).post('/api/patients').set('Authorization', world.auth.hw1).send({
      name: 'Someone',
      sex: 'male',
      dateOfBirth: '2000-01-01',
      villageId: world.villages.v2.id,
    });
    expect(res.status).toBe(403);
  });

  it("cannot read a session from another village, and a query param can't widen the scope", async () => {
    const s = await triage(world.auth.hw2, { patientId: world.patients.p2.id, input: adultInput(['cough']) });
    expect(
      (await request(app).get(`/api/triage/${s.body.session.id}`).set('Authorization', world.auth.hw1))
        .status,
    ).toBe(403);
    const list = await request(app)
      .get(`/api/triage?villageId=${world.villages.v2.id}`)
      .set('Authorization', world.auth.hw1);
    expect(list.body.total).toBe(0);
  });
});

describe('doctor-only review', () => {
  let sessionId: string;
  beforeEach(async () => {
    const s = await triage(world.auth.hw1, { patientId: world.patients.p1.id, input: adultInput(['cough']) });
    sessionId = s.body.session.id;
  });

  it.each(['hw1', 'patient', 'admin'] as const)('%s cannot review or add notes', async (who) => {
    const auth = world.auth[who];
    expect(
      (await request(app).post(`/api/triage/${sessionId}/review`).set('Authorization', auth).send({})).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/triage/${sessionId}/notes`)
          .set('Authorization', auth)
          .send({ text: 'x' })
      ).status,
    ).toBe(403);
  });

  it('a doctor can review any session', async () => {
    const res = await request(app)
      .post(`/api/triage/${sessionId}/review`)
      .set('Authorization', world.auth.doctor)
      .send({});
    expect(res.status).toBe(200);
  });
});

describe('dashboard access', () => {
  it('patients cannot see statistics', async () => {
    expect(
      (await request(app).get('/api/dashboard/stats').set('Authorization', world.auth.patient)).status,
    ).toBe(403);
  });

  it('health workers cannot request another village', async () => {
    const res = await request(app)
      .get(`/api/dashboard/stats?villageId=${world.villages.v2.id}`)
      .set('Authorization', world.auth.hw1);
    expect(res.status).toBe(403);
  });
});
