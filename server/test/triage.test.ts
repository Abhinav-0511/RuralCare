import { triageLevels } from '@ruralcare/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHttpAiClient } from '../src/services/aiClient';
import {
  adultInput,
  AI_DOWN,
  buildWorld,
  fakeAi,
  makeApp,
  modelSays,
  useTestDb,
  type World,
} from './helpers';

useTestDb();
let world: World;
beforeEach(async () => {
  world = await buildWorld();
});

const post = (
  app: ReturnType<typeof makeApp>,
  input: object,
  auth = world.auth.hw1,
  patientId = world.patients.p1.id,
) => request(app).post('/api/triage').set('Authorization', auth).send({ patientId, input });

const sync = (app: ReturnType<typeof makeApp>, input: object) =>
  request(app)
    .post('/api/triage/sync')
    .set('Authorization', world.auth.hw1)
    .send({
      sessions: [
        {
          clientId: crypto.randomUUID(),
          patientId: world.patients.p1.id,
          clientCreatedAt: new Date().toISOString(),
          input,
        },
      ],
    });

describe('red flags bypass the model', () => {
  it('chest pain => EMERGENCY from the rule engine; the model is never called', async () => {
    const ai = fakeAi(modelSays('SELF_CARE'));
    const res = await post(makeApp(ai), adultInput(['chest_pain', 'sweating']));

    expect(res.status).toBe(201);
    expect(res.body.session.result).toMatchObject({
      level: 'EMERGENCY',
      source: 'rule_engine',
      redFlags: ['RF_CHEST_PAIN'],
      model: { status: 'not_called' },
    });
    expect(ai.calls).toHaveLength(0);
    expect(res.body.guidance.title.en).toContain('108');
    expect(res.body.guidance.reasons[0].en).toBe('Chest pain');
  });

  it('red flags still work when the AI service is down', async () => {
    const res = await post(makeApp(fakeAi(AI_DOWN)), adultInput(['seizure']));
    expect(res.body.session.result).toMatchObject({ level: 'EMERGENCY', source: 'rule_engine' });
    expect(res.body.guidance.notice).toBeUndefined();
  });
});

describe('model path', () => {
  it('uses the model level when no red flag matches', async () => {
    const ai = fakeAi(modelSays('SEE_DOCTOR_SOON'));
    const res = await post(makeApp(ai), adultInput(['itching', 'skin_rash']));

    expect(res.body.session.result).toMatchObject({
      level: 'SEE_DOCTOR_SOON',
      source: 'model',
      model: { status: 'ok', modelVersion: 'test-model-1', confidence: 0.87 },
    });
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toMatchObject({ symptoms: ['itching', 'skin_rash'], sex: 'female' });
  });

  it("lists the model's possible conditions with names and advice in en/ta/hi", async () => {
    const ai = fakeAi({
      status: 'ok',
      prediction: {
        level: 'SEE_DOCTOR_24H',
        confidence: 0.7,
        lowConfidence: false,
        modelVersion: 'test-model-1',
        topConditions: [
          { id: 'dengue', probability: 0.7 },
          { id: 'malaria', probability: 0.2 },
          { id: 'typhoid', probability: 0.05 },
        ],
      },
    });
    const res = await post(makeApp(ai), adultInput(['high_fever', 'joint_pain', 'pain_behind_the_eyes']));
    const conditions = res.body.guidance.possibleConditions;
    expect(conditions.map((c: { id: string }) => c.id)).toEqual(['dengue', 'malaria', 'typhoid']);
    expect(conditions[0]).toMatchObject({
      probability: 0.7,
      triageLevel: 'SEE_DOCTOR_24H',
      name: { ta: 'டெங்கு' },
    });
    expect(conditions[0].advice.hi.length).toBeGreaterThan(10);
    expect(res.body.session.result.model).toMatchObject({
      lowConfidence: false,
      modelVersion: 'test-model-1',
    });
  });

  it("escalates to EMERGENCY when the AI service's own rules find a red flag", async () => {
    const ai = fakeAi({ status: 'rules_emergency', redFlags: ['RF_NEW_RULE_ON_AI'] });
    const res = await post(makeApp(ai), adultInput(['cough']));
    expect(res.body.session.result).toMatchObject({
      level: 'EMERGENCY',
      source: 'rule_engine',
      redFlags: ['RF_NEW_RULE_ON_AI'],
    });
    expect(res.body.guidance.possibleConditions).toEqual([]);
  });

  it('every result carries the disclaimer', async () => {
    const res = await post(makeApp(fakeAi(modelSays('SELF_CARE'))), adultInput(['cough']));
    expect(res.body.guidance.disclaimer).toEqual(triageLevels.disclaimer);
  });
});

describe('AI service unavailable => rules-only fallback (never a silent SELF_CARE)', () => {
  it('returns SEE_DOCTOR_SOON with source rule_engine_fallback and a notice', async () => {
    const res = await post(makeApp(fakeAi(AI_DOWN)), adultInput(['cough', 'runny_nose']));

    expect(res.status).toBe(201);
    expect(res.body.session.result).toMatchObject({
      level: 'SEE_DOCTOR_SOON',
      source: 'rule_engine_fallback',
      model: { status: 'unavailable', reason: 'AI service unreachable' },
    });
    expect(res.body.guidance.notice).toEqual(triageLevels.modelUnavailable.notice);
  });

  it('works against a real unreachable AI service URL', async () => {
    const ai = createHttpAiClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 });
    const res = await post(makeApp(ai), adultInput(['cough']));

    expect(res.status).toBe(201);
    expect(res.body.session.result.source).toBe('rule_engine_fallback');
    expect(res.body.session.result.level).not.toBe('SELF_CARE');
  });

  it('survives an AI client that throws', async () => {
    const ai = fakeAi(() => {
      throw new Error('boom');
    });
    const res = await post(makeApp(ai), adultInput(['cough']));
    expect(res.status).toBe(201);
    expect(res.body.session.result).toMatchObject({
      source: 'rule_engine_fallback',
      level: 'SEE_DOCTOR_SOON',
    });
  });
});

describe('age is required; missing age is still handled safely', () => {
  it('POST /api/triage rejects a request without ageMonths', async () => {
    const res = await post(makeApp(), { symptoms: ['cough'] });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('input.ageMonths');
  });

  it('a synced session without age and with fever is floored at SEE_DOCTOR_24H, even if the model says SELF_CARE', async () => {
    const res = await sync(makeApp(fakeAi(modelSays('SELF_CARE'))), { symptoms: ['mild_fever', 'cough'] });
    expect(res.body.results[0]).toMatchObject({ status: 'created', level: 'SEE_DOCTOR_24H' });
  });

  it('...and also when the AI service is down', async () => {
    const res = await sync(makeApp(fakeAi(AI_DOWN)), { symptoms: ['high_fever'] });
    expect(res.body.results[0]).toMatchObject({ status: 'created', level: 'SEE_DOCTOR_24H' });
  });

  it('a measured temperature >= 38C without age is also floored', async () => {
    const res = await sync(makeApp(fakeAi(modelSays('SELF_CARE'))), {
      symptoms: ['headache'],
      temperatureC: 38.4,
    });
    expect(res.body.results[0].level).toBe('SEE_DOCTOR_24H');
  });

  it('without fever, a missing age does not change the model result', async () => {
    const res = await sync(makeApp(fakeAi(modelSays('SELF_CARE'))), { symptoms: ['cough'] });
    expect(res.body.results[0].level).toBe('SELF_CARE');
  });
});

describe('input handling', () => {
  it('rejects unknown symptom ids', async () => {
    const res = await post(makeApp(), adultInput(['cough', 'made_up']));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'UNKNOWN_SYMPTOMS', details: { unknown: ['made_up'] } });
  });

  it('normalises and de-duplicates symptoms', async () => {
    const res = await post(
      makeApp(fakeAi(modelSays('SELF_CARE'))),
      adultInput([' Cough', 'cough', 'RUNNY_NOSE']),
    );
    expect(res.body.session.input.symptoms).toEqual(['cough', 'runny_nose']);
  });

  it('requires patientId for staff', async () => {
    const res = await request(makeApp())
      .post('/api/triage')
      .set('Authorization', world.auth.hw1)
      .send({ input: adultInput(['cough']) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PATIENT_REQUIRED');
  });

  it('returns 404 for an unknown patient and 400 for a malformed id', async () => {
    expect(
      (await post(makeApp(), adultInput(['cough']), world.auth.admin, '665f1c2e8b3e4a0012345678')).status,
    ).toBe(404);
    expect((await post(makeApp(), adultInput(['cough']), world.auth.admin, 'abc')).status).toBe(400);
  });
});
