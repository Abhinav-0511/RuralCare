import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { adultInput, buildWorld, fakeAi, makeApp, modelSays, useTestDb, type World } from './helpers';

useTestDb();
const app = makeApp(fakeAi(modelSays('SEE_DOCTOR_24H')));
let world: World;
let sessionId: string;

beforeEach(async () => {
  world = await buildWorld();
  const res = await request(app)
    .post('/api/triage')
    .set('Authorization', world.auth.hw1)
    .send({ patientId: world.patients.p1.id, input: adultInput(['diarrhoea', 'vomiting']) });
  sessionId = res.body.session.id;
});

const asDoctor = (path: string, body: object = {}) =>
  request(app).post(path).set('Authorization', world.auth.doctor).send(body);

describe('doctor notes', () => {
  it('adds a note attributed to the doctor', async () => {
    const res = await asDoctor(`/api/triage/${sessionId}/notes`, { text: 'Called patient, advised ORS.' });
    expect(res.status).toBe(201);
    expect(res.body.session.review.notes).toHaveLength(1);
    expect(res.body.session.review.notes[0]).toMatchObject({
      text: 'Called patient, advised ORS.',
      doctorId: world.users.doctor.id,
    });
    expect(res.body.session.review.status).toBe('pending'); // a note alone doesn't mark it reviewed
  });

  it('rejects an empty note', async () => {
    const res = await asDoctor(`/api/triage/${sessionId}/notes`, { text: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('marking a session reviewed', () => {
  it('sets status, reviewer, time and an optional note', async () => {
    const res = await asDoctor(`/api/triage/${sessionId}/review`, { note: 'Agree with triage.' });
    expect(res.status).toBe(200);
    expect(res.body.session.review).toMatchObject({ status: 'reviewed', reviewedBy: world.users.doctor.id });
    expect(new Date(res.body.session.review.reviewedAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(res.body.session.review.notes.map((n: { text: string }) => n.text)).toEqual([
      'Agree with triage.',
    ]);
  });

  it('cannot be reviewed twice', async () => {
    await asDoctor(`/api/triage/${sessionId}/review`).expect(200);
    const again = await asDoctor(`/api/triage/${sessionId}/review`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REVIEWED');
  });

  it('returns 404 / 400 for unknown or malformed ids', async () => {
    expect((await asDoctor('/api/triage/665f1c2e8b3e4a0012345678/review')).status).toBe(404);
    expect((await asDoctor('/api/triage/xyz/review')).status).toBe(400);
  });

  it('the review queue can be filtered by status', async () => {
    const second = await request(app)
      .post('/api/triage')
      .set('Authorization', world.auth.hw1)
      .send({ patientId: world.patients.p1.id, input: adultInput(['cough']) });
    await asDoctor(`/api/triage/${sessionId}/review`).expect(200);

    const pending = await request(app)
      .get('/api/triage?reviewStatus=pending')
      .set('Authorization', world.auth.doctor);
    expect(pending.body.items.map((s: { id: string }) => s.id)).toEqual([second.body.session.id]);
  });

  it('the health worker sees the doctor review on the session', async () => {
    await asDoctor(`/api/triage/${sessionId}/review`, { note: 'Visit PHC tomorrow.' }).expect(200);
    const res = await request(app).get(`/api/triage/${sessionId}`).set('Authorization', world.auth.hw1);
    expect(res.body.session.review.status).toBe('reviewed');
    expect(res.body.guidance.disclaimer.en).toMatch(/not a medical diagnosis/);
  });
});
