import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { TriageSession } from '../src/models/triageSession';
import { adultInput, buildWorld, fakeAi, makeApp, modelSays, useTestDb, type World } from './helpers';

useTestDb();
const ai = fakeAi(modelSays('SELF_CARE'));
const app = makeApp(ai);
let world: World;
beforeEach(async () => {
  world = await buildWorld();
  ai.calls.length = 0;
});

const item = (overrides: Record<string, unknown> = {}) => ({
  clientId: randomUUID(),
  patientId: world.patients.p1.id,
  clientCreatedAt: '2026-09-20T09:30:00+05:30',
  input: adultInput(['cough']),
  clientResult: { level: 'SELF_CARE', source: 'model', rulesVersion: '1.1.0', modelVersion: 'device-1' },
  ...overrides,
});

const sync = (sessions: object[], auth = world.auth.hw1) =>
  request(app).post('/api/triage/sync').set('Authorization', auth).send({ sessions });

describe('idempotent sync', () => {
  it('sending the same clientId twice creates one session', async () => {
    const s = item();
    const first = await sync([s]);
    const second = await sync([s]);

    expect(first.body.results[0]).toMatchObject({ clientId: s.clientId, status: 'created' });
    expect(second.body.results[0]).toMatchObject({
      clientId: s.clientId,
      status: 'duplicate',
      sessionId: first.body.results[0].sessionId,
    });
    expect(await TriageSession.countDocuments()).toBe(1);
    expect(ai.calls).toHaveLength(1); // the duplicate is not re-evaluated
  });

  it('a duplicate inside the same batch is detected', async () => {
    const s = item();
    const res = await sync([s, s]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['created', 'duplicate']);
    expect(await TriageSession.countDocuments()).toBe(1);
  });

  it('concurrent uploads of the same clientId still create exactly one session', async () => {
    const s = item();
    const responses = await Promise.all(Array.from({ length: 6 }, () => sync([s])));
    const statuses = responses.map((r) => r.body.results[0].status).sort();

    expect(statuses.filter((x) => x === 'created')).toHaveLength(1);
    expect(statuses.filter((x) => x === 'duplicate')).toHaveLength(5);
    expect(await TriageSession.countDocuments({ clientId: s.clientId })).toBe(1);
  });

  it('POST /api/triage is idempotent on clientId too (including concurrent retries)', async () => {
    const clientId = randomUUID();
    const body = { clientId, patientId: world.patients.p1.id, input: adultInput(['cough']) };
    const send = () => request(app).post('/api/triage').set('Authorization', world.auth.hw1).send(body);

    const first = await send();
    const retry = await send();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.session.id).toBe(first.body.session.id);

    const clientId2 = randomUUID();
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/triage')
          .set('Authorization', world.auth.hw1)
          .send({ ...body, clientId: clientId2 }),
      ),
    );
    expect(concurrent.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await TriageSession.countDocuments()).toBe(2);
  });

  it('a clientId already used for another patient is rejected, not overwritten', async () => {
    const s = item();
    await sync([s]);
    const res = await sync([{ ...s, patientId: world.patients.p2.id }], world.auth.admin);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'CLIENT_ID_CONFLICT' } });
    expect(await TriageSession.countDocuments()).toBe(1);
  });
});

describe('server verdict wins', () => {
  it('re-evaluates offline sessions and flags a changed verdict', async () => {
    // The device (e.g. with outdated rules) showed SELF_CARE for chest pain.
    const s = item({ input: adultInput(['chest_pain']) });
    const res = await sync([s]);

    expect(res.body.results[0]).toMatchObject({
      status: 'created',
      level: 'EMERGENCY',
      verdictChanged: true,
    });
    const stored = await TriageSession.findOne({ clientId: s.clientId });
    expect(stored!.result.level).toBe('EMERGENCY');
    expect(stored!.clientResult).toMatchObject({ level: 'SELF_CARE', modelVersion: 'device-1' });
    expect(stored!.origin).toBe('offline_sync');
  });

  it('verdictChanged is false when the device and server agree', async () => {
    const res = await sync([item()]);
    expect(res.body.results[0]).toMatchObject({ level: 'SELF_CARE', verdictChanged: false });
  });
});

describe('batch behaviour', () => {
  it('rejects items outside the caller scope without failing the batch', async () => {
    const ok = item();
    const outOfScope = item({ patientId: world.patients.p2.id });
    const res = await sync([ok, outOfScope]);

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe('created');
    expect(res.body.results[1]).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });
  });

  it('keeps the client time as occurredAt, but clamps future device clocks', async () => {
    const past = item();
    const future = item({ clientCreatedAt: new Date(Date.now() + 86_400_000).toISOString() });
    await sync([past, future]);

    const storedPast = await TriageSession.findOne({ clientId: past.clientId });
    expect(storedPast!.occurredAt.toISOString()).toBe('2026-09-20T04:00:00.000Z');
    const storedFuture = await TriageSession.findOne({ clientId: future.clientId });
    expect(storedFuture!.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('validates the batch (size limit, uuid clientId)', async () => {
    expect((await sync([])).status).toBe(400);
    expect((await sync([item({ clientId: 'not-a-uuid' })])).status).toBe(400);
    expect((await sync(Array.from({ length: 51 }, () => item()))).status).toBe(400);
  });
});
