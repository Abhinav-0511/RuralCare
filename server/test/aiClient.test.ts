import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpAiClient } from '../src/services/aiClient';

// A tiny stand-in for the FastAPI service; each test sets what it responds with.
let respond: (res: import('node:http').ServerResponse) => void = () => {};
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/health') return void res.end('{"status":"ok"}');
    respond(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const sendJson = (status: number, body: unknown) => (res: import('node:http').ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const input = { symptoms: ['cough'], ageMonths: 400 };
// Shape of ai-service /predict (names/advice omitted: the server drops them).
const validPrediction = {
  level: 'SELF_CARE',
  source: 'model',
  confidence: 0.91,
  lowConfidence: false,
  modelVersion: 'lr-1',
  topConditions: [{ id: 'common_cold', probability: 0.91 }],
  redFlags: [],
};

describe('createHttpAiClient', () => {
  it('returns the prediction on success', async () => {
    respond = sendJson(200, validPrediction);
    const outcome = await createHttpAiClient({ baseUrl, timeoutMs: 1000 }).predict(input);
    expect(outcome).toEqual({
      status: 'ok',
      prediction: {
        level: 'SELF_CARE',
        confidence: 0.91,
        lowConfidence: false,
        modelVersion: 'lr-1',
        topConditions: [{ id: 'common_cold', probability: 0.91 }],
      },
    });
  });

  it('treats a MODEL that claims EMERGENCY as unavailable (only rules may say EMERGENCY)', async () => {
    respond = sendJson(200, { ...validPrediction, level: 'EMERGENCY' });
    const outcome = await createHttpAiClient({ baseUrl, timeoutMs: 1000 }).predict(input);
    expect(outcome).toEqual({ status: 'unavailable', reason: 'AI service returned an invalid prediction' });
  });

  it("accepts an EMERGENCY from the AI service's own red-flag rules", async () => {
    respond = sendJson(200, {
      ...validPrediction,
      level: 'EMERGENCY',
      source: 'rule_engine',
      confidence: null,
      topConditions: [],
      redFlags: ['RF_CHEST_PAIN'],
    });
    const outcome = await createHttpAiClient({ baseUrl, timeoutMs: 1000 }).predict(input);
    expect(outcome).toEqual({ status: 'rules_emergency', redFlags: ['RF_CHEST_PAIN'] });
  });

  it('treats HTTP errors as unavailable', async () => {
    respond = sendJson(503, { detail: 'model not loaded' });
    const outcome = await createHttpAiClient({ baseUrl, timeoutMs: 1000 }).predict(input);
    expect(outcome).toEqual({ status: 'unavailable', reason: 'AI service responded with HTTP 503' });
  });

  it('times out instead of hanging', async () => {
    respond = (res) => setTimeout(() => sendJson(200, validPrediction)(res), 1000);
    const outcome = await createHttpAiClient({ baseUrl, timeoutMs: 100 }).predict(input);
    expect(outcome).toEqual({ status: 'unavailable', reason: 'AI service timed out' });
  });

  it('handles an unreachable service', async () => {
    const client = createHttpAiClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
    expect(await client.predict(input)).toEqual({ status: 'unavailable', reason: 'AI service unreachable' });
    expect(await client.isHealthy()).toBe(false);
  });

  it('reports health', async () => {
    expect(await createHttpAiClient({ baseUrl, timeoutMs: 1000 }).isHealthy()).toBe(true);
  });

  it('fetches the model version, or null if unavailable', async () => {
    const version = {
      modelVersion: 'lr-1',
      algorithm: 'Logistic Regression',
      createdAt: '2026-10-04T00:00:00Z',
      sha256: 'b'.repeat(64),
      sizeBytes: 1,
      featureCount: 131,
      classCount: 41,
    };
    respond = sendJson(200, version);
    expect(await createHttpAiClient({ baseUrl, timeoutMs: 1000 }).modelVersion()).toEqual(version);
    respond = sendJson(503, { detail: 'Model not loaded' });
    expect(await createHttpAiClient({ baseUrl, timeoutMs: 1000 }).modelVersion()).toBeNull();
  });
});
