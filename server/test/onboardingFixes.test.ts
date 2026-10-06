import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Patient } from '../src/models/patient';
import { User } from '../src/models/user';
import { Village } from '../src/models/village';
import { buildWorld, makeApp, useTestDb, type World } from './helpers';

useTestDb();
const app = makeApp();
let world: World;
beforeEach(async () => {
  world = await buildWorld();
});

const createLogin = (auth: string, patientId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/patients/${patientId}/login`).set('Authorization', auth).send(body);
const login = (phone: string, password: string) =>
  request(app).post('/api/auth/login').send({ phone, password });

describe('login for an already-registered patient', () => {
  it('health worker of the village creates it with a temporary password that must be changed', async () => {
    // p2 (village 2) was registered without a phone or login
    const res = await createLogin(world.auth.hw2, world.patients.p2.id, {
      phone: '9876500001',
      preferredLanguage: 'hi',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ phone: '9876500001', temporaryPassword: expect.any(String) });

    const user = await User.findOne({ phone: '9876500001' });
    expect(user).toMatchObject({ role: 'patient', mustChangePassword: true, preferredLanguage: 'hi' });
    const patient = await Patient.findById(world.patients.p2.id);
    expect(String(patient!.userId)).toBe(user!.id);
    expect(patient!.phone).toBe('9876500001'); // saved on the record

    const first = await login('9876500001', res.body.temporaryPassword);
    expect(first.body.user).toMatchObject({ mustChangePassword: true, patientId: world.patients.p2.id });
    const blocked = await request(app)
      .get('/api/triage')
      .set('Authorization', `Bearer ${first.body.tokens.accessToken}`);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('uses the phone already on the record and refuses a different one', async () => {
    await Patient.updateOne({ _id: world.patients.p2.id }, { phone: '9876500002' });
    expect(
      (await createLogin(world.auth.hw2, world.patients.p2.id, { phone: '9876500003' })).body.error.code,
    ).toBe('PHONE_MISMATCH');
    const res = await createLogin(world.auth.hw2, world.patients.p2.id);
    expect(res.body.phone).toBe('9876500002');
  });

  it('only in their own villages; not for doctors or patients', async () => {
    const other = await createLogin(world.auth.hw1, world.patients.p2.id, { phone: '9876500004' });
    expect(other.status).toBe(403);
    expect((await createLogin(world.auth.doctor, world.patients.p2.id, { phone: '9876500004' })).status).toBe(
      403,
    );
    expect(
      (await createLogin(world.auth.patient, world.patients.p2.id, { phone: '9876500004' })).status,
    ).toBe(403);
    expect(await User.exists({ phone: '9876500004' })).toBeNull();
    // admin may
    expect((await createLogin(world.auth.admin, world.patients.p2.id, { phone: '9876500004' })).status).toBe(
      201,
    );
  });

  it('refuses a second login, a missing phone and a phone that already has a login', async () => {
    expect((await createLogin(world.auth.hw1, world.patients.p1.id)).body.error.code).toBe('LOGIN_EXISTS');
    expect((await createLogin(world.auth.hw2, world.patients.p2.id)).body.error.code).toBe('PHONE_REQUIRED');
    const taken = await createLogin(world.auth.hw2, world.patients.p2.id, { phone: '9000000011' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('PHONE_TAKEN');
    expect((await Patient.findById(world.patients.p2.id))!.phone).toBeUndefined(); // record unchanged
  });
});

describe('deactivating villages', () => {
  const patchVillage = (id: string, body: Record<string, unknown>, auth = world.auth.admin) =>
    request(app).patch(`/api/villages/${id}`).set('Authorization', auth).send(body);

  it('is blocked while active staff are assigned, with a clear message', async () => {
    const res = await patchVillage(world.villages.v1.id, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VILLAGE_HAS_STAFF');
    expect(res.body.error.message).toContain('Health Worker One');
    expect((await Village.findById(world.villages.v1.id))!.isActive).toBe(true);
  });

  it('hides the village from new registrations and staff assignments but keeps patients and history', async () => {
    await request(app)
      .post('/api/triage')
      .set('Authorization', world.auth.hw2)
      .send({ patientId: world.patients.p2.id, input: { symptoms: ['cough'], ageMonths: 400 } })
      .expect(201);
    // move hw2 away, then deactivate village 2
    await request(app)
      .patch(`/api/users/${world.users.hw2.id}`)
      .set('Authorization', world.auth.admin)
      .send({ villageIds: [world.villages.v1.id] })
      .expect(200);
    const off = await patchVillage(world.villages.v2.id, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);

    // listed with isActive, and filtered out with ?active=true
    const all = await request(app).get('/api/villages');
    expect(all.body).toHaveLength(2);
    const active = await request(app).get('/api/villages?active=true');
    expect(active.body.map((v: { id: string }) => v.id)).toEqual([world.villages.v1.id]);

    // no new patients there (admin can reach every village)
    const reg = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.admin)
      .send({ name: 'New Person', sex: 'male', dateOfBirth: '1990-01-01', villageId: world.villages.v2.id });
    expect(reg.body.error.code).toBe('VILLAGE_INACTIVE');
    // no new staff assignments there
    const assign = await request(app)
      .patch(`/api/users/${world.users.hw1.id}`)
      .set('Authorization', world.auth.admin)
      .send({ villageIds: [world.villages.v1.id, world.villages.v2.id] });
    expect(assign.body.error.code).toBe('VILLAGE_INACTIVE');

    // existing patient and history kept, still visible to doctors
    const patient = await request(app)
      .get(`/api/patients/${world.patients.p2.id}`)
      .set('Authorization', world.auth.doctor);
    expect(patient.status).toBe(200);
    const sessions = await request(app)
      .get(`/api/triage?patientId=${world.patients.p2.id}`)
      .set('Authorization', world.auth.doctor);
    expect(sessions.body.total).toBe(1);

    // and it can be reactivated
    expect((await patchVillage(world.villages.v2.id, { isActive: true })).body.isActive).toBe(true);
  });

  it('a deactivated staff member does not block it, but cannot be reactivated into it', async () => {
    await request(app)
      .patch(`/api/users/${world.users.hw2.id}`)
      .set('Authorization', world.auth.admin)
      .send({ isActive: false })
      .expect(200);
    expect((await patchVillage(world.villages.v2.id, { isActive: false })).status).toBe(200);
    const back = await request(app)
      .patch(`/api/users/${world.users.hw2.id}`)
      .set('Authorization', world.auth.admin)
      .send({ isActive: true });
    expect(back.body.error.code).toBe('VILLAGE_INACTIVE');
  });

  it('only admins can deactivate', async () => {
    expect((await patchVillage(world.villages.v2.id, { isActive: false }, world.auth.hw2)).status).toBe(403);
  });

  it('villages created before this change (no isActive field) count as active', async () => {
    await Village.collection.updateMany({}, { $unset: { isActive: '' } });
    expect((await request(app).get('/api/villages?active=true')).body).toHaveLength(2);
    const reg = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send({ name: 'New Person', sex: 'male', dateOfBirth: '1990-01-01', villageId: world.villages.v1.id });
    expect(reg.status).toBe(201);
  });
});
