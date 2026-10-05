import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Patient } from '../src/models/patient';
import { User } from '../src/models/user';
import { Village } from '../src/models/village';
import { adultInput, bearer, buildWorld, makeApp, PASSWORD, useTestDb, type World } from './helpers';

useTestDb();
const app = makeApp();
let world: World;
beforeEach(async () => {
  world = await buildWorld();
});

const newPatient = (villageId: string, extra: Record<string, unknown> = {}) => ({
  name: 'Kaveri Natarajan',
  sex: 'female',
  dateOfBirth: '1995-03-10',
  villageId,
  phone: '9876543210',
  ...extra,
});
const login = (phone: string, password: string) =>
  request(app).post('/api/auth/login').send({ phone, password });

describe('no public endpoint can create an account', () => {
  it('every unauthenticated POST leaves the users collection unchanged', async () => {
    const before = await User.countDocuments();
    const attempt = {
      name: 'Mallory',
      phone: '9123456789',
      password: 'Secret@123',
      role: 'admin',
      sex: 'female',
      dateOfBirth: '1990-01-01',
      villageId: world.villages.v1.id,
      createLogin: true,
      input: adultInput(['cough']),
    };
    const publicPosts = [
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/refresh',
      '/api/auth/password-reset/request',
      '/api/auth/password-reset/confirm',
      '/api/guest/triage',
      '/api/users',
      '/api/patients',
      '/api/villages',
    ];
    for (const path of publicPosts) {
      const res = await request(app).post(path).send(attempt);
      expect(res.status, path).not.toBe(201);
    }
    expect(await User.countDocuments()).toBe(before);
    expect(await User.exists({ phone: '9123456789' })).toBeNull();
  });
});

describe('roles can only be set by an admin', () => {
  it('non-admins cannot create or edit users', async () => {
    for (const auth of [world.auth.hw1, world.auth.doctor, world.auth.patient]) {
      const create = await request(app)
        .post('/api/users')
        .set('Authorization', auth)
        .send({ name: 'Eve', phone: '9123456780', password: 'Secret@123', role: 'admin' });
      expect(create.status).toBe(403);
    }
    // ...not even themselves
    const self = await request(app)
      .patch(`/api/users/${world.users.hw1.id}`)
      .set('Authorization', world.auth.hw1)
      .send({ role: 'admin' });
    expect(self.status).toBe(403);
    expect((await User.findById(world.users.hw1.id))!.role).toBe('health_worker');
  });

  it('a patient login created by a health worker is always role=patient', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(
        newPatient(world.villages.v1.id, {
          createLogin: true,
          role: 'admin',
          villageIds: [world.villages.v2.id],
        }),
      );
    expect(res.status).toBe(201);
    const user = await User.findOne({ phone: '9876543210' });
    expect(user).toMatchObject({ role: 'patient', mustChangePassword: true });
    expect(user!.villageIds).toHaveLength(0);
  });

  it('patient accounts cannot be turned into staff, and /api/users cannot create patients', async () => {
    const promote = await request(app)
      .patch(`/api/users/${world.users.patientUser.id}`)
      .set('Authorization', world.auth.admin)
      .send({ role: 'doctor' });
    expect(promote.body.error.code).toBe('INVALID_ROLE_CHANGE');
    const create = await request(app)
      .post('/api/users')
      .set('Authorization', world.auth.admin)
      .send({ name: 'Pat', phone: '9123456781', role: 'patient' });
    expect(create.status).toBe(400);
  });
});

describe('health workers register patients in their own villages only', () => {
  it('registers a patient with a login; the temporary password is returned once', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v1.id, { createLogin: true, preferredLanguage: 'ta' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Kaveri Natarajan', villageId: world.villages.v1.id });
    expect(res.body.login).toEqual({ phone: '9876543210', temporaryPassword: expect.any(String) });
    expect(res.body.login.temporaryPassword.length).toBeGreaterThanOrEqual(10);

    // linked both ways, and in the health worker's list
    const user = await User.findOne({ phone: '9876543210' });
    expect(String(user!.patientId)).toBe(res.body.id);
    expect(res.body.userId).toBe(user!.id);
    expect(user!.preferredLanguage).toBe('ta');
    const list = await request(app).get('/api/patients').set('Authorization', world.auth.hw1);
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(res.body.id);

    // the password works (and is not stored in clear)
    expect((await login('9876543210', res.body.login.temporaryPassword)).status).toBe(200);
    expect(JSON.stringify(await User.findById(user!.id).select('+passwordHash').lean())).not.toContain(
      res.body.login.temporaryPassword,
    );
  });

  it("refuses another village and doctors; doesn't leave a patient behind", async () => {
    const other = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v2.id, { createLogin: true }));
    expect(other.status).toBe(403);
    const doctor = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.doctor)
      .send(newPatient(world.villages.v1.id));
    expect(doctor.status).toBe(403);
    expect(await Patient.exists({ phone: '9876543210' })).toBeNull();
    expect(await User.exists({ phone: '9876543210' })).toBeNull();
  });

  it('warns about a duplicate phone, and allows it only when confirmed', async () => {
    await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v1.id))
      .expect(201);
    const dup = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v1.id, { name: 'Kaveri N' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_PHONE');

    const sharedPhone = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v1.id, { name: 'Her daughter', allowDuplicatePhone: true }));
    expect(sharedPhone.status).toBe(201);
    expect(await Patient.countDocuments({ phone: '9876543210' })).toBe(2);
  });

  it('a login needs a phone number that no other account uses', async () => {
    const noPhone = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v1.id, { phone: undefined, createLogin: true }));
    expect(noPhone.status).toBe(400);

    const taken = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v1.id, { phone: '9000000011', createLogin: true })); // hw1's own phone
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('PHONE_TAKEN');
  });

  it('resets passwords only for patients in their own villages, revoking old sessions', async () => {
    const oldToken = world.auth.patient;
    const other = await request(app)
      .post(`/api/patients/${world.patients.p1.id}/reset-password`)
      .set('Authorization', world.auth.hw2);
    expect(other.status).toBe(403);
    const patientSelf = await request(app)
      .post(`/api/patients/${world.patients.p1.id}/reset-password`)
      .set('Authorization', world.auth.patient);
    expect(patientSelf.status).toBe(403);

    const res = await request(app)
      .post(`/api/patients/${world.patients.p1.id}/reset-password`)
      .set('Authorization', world.auth.hw1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phone: '9000000021', temporaryPassword: expect.any(String) });
    expect((await request(app).get('/api/auth/me').set('Authorization', oldToken)).status).toBe(401);
    expect((await login('9000000021', PASSWORD)).status).toBe(401);
    const fresh = await login('9000000021', res.body.temporaryPassword);
    expect(fresh.body.user.mustChangePassword).toBe(true);

    const noLogin = await request(app)
      .post(`/api/patients/${world.patients.p2.id}/reset-password`)
      .set('Authorization', world.auth.hw2);
    expect(noLogin.body.error.code).toBe('NO_LOGIN');
  });
});

describe('temporary passwords must be changed at first login', () => {
  async function registered() {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', world.auth.hw1)
      .send(newPatient(world.villages.v1.id, { createLogin: true }));
    const first = await login('9876543210', res.body.login.temporaryPassword);
    return { temp: res.body.login.temporaryPassword as string, first };
  }

  it('everything except change-password, /me and logout is refused until then', async () => {
    const { first } = await registered();
    expect(first.status).toBe(200);
    expect(first.body.user.mustChangePassword).toBe(true);
    const auth = `Bearer ${first.body.tokens.accessToken}`;

    for (const path of ['/api/triage', '/api/patients', '/api/alerts']) {
      const res = await request(app).get(path).set('Authorization', auth);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    const triage = await request(app)
      .post('/api/triage')
      .set('Authorization', auth)
      .send({ input: adultInput(['cough']) });
    expect(triage.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await request(app).get('/api/auth/me').set('Authorization', auth)).status).toBe(200);
  });

  it('changing it lifts the restriction, signs out other sessions and retires the temporary password', async () => {
    const { temp, first } = await registered();
    const oldAuth = `Bearer ${first.body.tokens.accessToken}`;

    const same = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', oldAuth)
      .send({ currentPassword: temp, newPassword: temp });
    expect(same.status).toBe(400);
    const wrong = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', oldAuth)
      .send({ currentPassword: 'not-it-at-all', newPassword: 'MyNewPass@1' });
    expect(wrong.status).toBe(401);

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', oldAuth)
      .send({ currentPassword: temp, newPassword: 'MyNewPass@1' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    expect((await request(app).get('/api/auth/me').set('Authorization', oldAuth)).status).toBe(401);
    const newAuth = `Bearer ${changed.body.tokens.accessToken}`;
    expect((await request(app).get('/api/triage').set('Authorization', newAuth)).status).toBe(200);
    expect((await login('9876543210', temp)).status).toBe(401);
    expect((await login('9876543210', 'MyNewPass@1')).status).toBe(200);
  });

  it('staff created by an admin without a password get a temporary one too', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', world.auth.admin)
      .send({
        name: 'New Worker',
        phone: '9123456782',
        role: 'health_worker',
        villageIds: [world.villages.v1.id],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: 'health_worker', mustChangePassword: true });
    const first = await login('9123456782', res.body.temporaryPassword);
    expect(first.body.user.mustChangePassword).toBe(true);
  });
});

describe('admin user and village management', () => {
  it('edits villages and deactivates a health worker, revoking their sessions', async () => {
    const hwAuth = world.auth.hw1;
    const res = await request(app)
      .patch(`/api/users/${world.users.hw1.id}`)
      .set('Authorization', world.auth.admin)
      .send({ villageIds: [world.villages.v2.id] });
    expect(res.body.villageIds).toEqual([world.villages.v2.id]);
    // takes effect at once: hw1 now sees village 2's patients, not village 1's
    const list = await request(app).get('/api/patients').set('Authorization', hwAuth);
    expect(list.body.items.map((p: { name: string }) => p.name)).toEqual(['Patient Two']);

    await request(app)
      .patch(`/api/users/${world.users.hw1.id}`)
      .set('Authorization', world.auth.admin)
      .send({ isActive: false })
      .expect(200);
    expect((await request(app).get('/api/patients').set('Authorization', hwAuth)).status).toBe(401);
  });

  it('resets a staff password; patients must be reset from their record', async () => {
    const res = await request(app)
      .post(`/api/users/${world.users.doctor.id}/reset-password`)
      .set('Authorization', world.auth.admin);
    expect(res.body).toEqual({ phone: '9000000002', temporaryPassword: expect.any(String) });
    expect((await login('9000000002', res.body.temporaryPassword)).body.user.mustChangePassword).toBe(true);

    const patient = await request(app)
      .post(`/api/users/${world.users.patientUser.id}/reset-password`)
      .set('Authorization', world.auth.admin);
    expect(patient.body.error.code).toBe('USE_PATIENT_RESET');
    const notAdmin = await request(app)
      .post(`/api/users/${world.users.doctor.id}/reset-password`)
      .set('Authorization', world.auth.hw1);
    expect(notAdmin.status).toBe(403);
  });

  it('only admins can create and edit villages', async () => {
    const edit = await request(app)
      .patch(`/api/villages/${world.villages.v1.id}`)
      .set('Authorization', world.auth.admin)
      .send({ name: 'Kelambakkam East' });
    expect(edit.body).toMatchObject({ name: 'Kelambakkam East', district: 'Chengalpattu' });

    for (const auth of [world.auth.hw1, world.auth.doctor, world.auth.patient]) {
      const res = await request(app)
        .patch(`/api/villages/${world.villages.v1.id}`)
        .set('Authorization', auth)
        .send({ name: 'Hacked' });
      expect(res.status).toBe(403);
    }
    expect(
      (await request(app).patch(`/api/villages/${world.villages.v1.id}`).send({ name: 'x' })).status,
    ).toBe(401);
    expect((await Village.findById(world.villages.v1.id))!.name).toBe('Kelambakkam East');
  });
});

it('existing accounts (no mustChangePassword field yet) keep working', async () => {
  // Data from before onboarding has no mustChangePassword field at all.
  await User.collection.updateMany({}, { $unset: { mustChangePassword: '' } });
  const res = await login('9000000011', PASSWORD);
  expect(res.status).toBe(200);
  expect((await request(app).get('/api/patients').set('Authorization', bearer(world.users.hw1))).status).toBe(
    200,
  );
});
