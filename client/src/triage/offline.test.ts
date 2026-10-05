// @vitest-environment node
// Offline triage, model updates and the sync outbox (IndexedDB via fake-indexeddb).
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ModelMetadataSchema } from '@ruralcare/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../lib/api';
import { db } from '../lib/db';
import { createPredictor, updateModel } from '../model/modelManager';
import { runLocalTriage } from './localTriage';
import { submitTriage } from './submit';
import { backoffMs, syncPending } from './sync';

const read = (p: string) => readFileSync(new URL(p, import.meta.url));
const modelBytes = read('../../public/models/triage_model.onnx');
const metadataJson = JSON.parse(read('../../public/models/model_metadata.json').toString());
const metadata = ModelMetadataSchema.parse(metadataJson);
const arrayBuffer = () =>
  modelBytes.buffer.slice(
    modelBytes.byteOffset,
    modelBytes.byteOffset + modelBytes.byteLength,
  ) as ArrayBuffer;
const adult = (symptoms: string[], extra = {}) => ({ symptoms, ageMonths: 420, ...extra });

// localStorage for the token store (node environment)
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
});
vi.stubGlobal('window', {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
});

beforeEach(async () => {
  await Promise.all([db.sessions.clear(), db.model.clear(), db.patients.clear()]);
  tokenStore.set({ accessToken: 'a', refreshToken: 'r' });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('runLocalTriage (offline)', () => {
  it('red flags => EMERGENCY from the rules, model not needed', async () => {
    const r = await runLocalTriage(adult(['chest_pain']), null);
    expect(r).toMatchObject({ source: 'rules', decision: { level: 'EMERGENCY' } });
    expect(r.guidance.title.en).toContain('108');
  });

  it('uses the on-device model when there is no red flag', async () => {
    const predictor = await createPredictor(arrayBuffer(), metadata);
    expect(predictor.runtime).toBe('built-in');
    const r = await runLocalTriage(
      adult(['runny_nose', 'congestion', 'sinus_pressure', 'loss_of_smell', 'cough']),
      predictor,
    );
    expect(r.source).toBe('offline_model');
    expect(r.guidance.possibleConditions[0]!.id).toBe('common_cold');
    expect(r.modelVersion).toBe(metadata.modelVersion);
  });

  it('without a model: rules-only fallback, never SELF_CARE', async () => {
    const r = await runLocalTriage(adult(['cough']), null);
    expect(r).toMatchObject({ source: 'rules_only', decision: { level: 'SEE_DOCTOR_SOON' } });
    expect(r.guidance.notice?.en).toMatch(/unavailable/);
  });

  it('applies the same safety floors as the server (severe => at least 24h)', async () => {
    const predictor = await createPredictor(arrayBuffer(), metadata);
    const r = await runLocalTriage(
      adult(['runny_nose', 'congestion', 'cough'], { severity: 'severe' }),
      predictor,
    );
    expect(r.decision.level).toBe('SEE_DOCTOR_24H');
  });
});

describe('submitTriage + syncPending', () => {
  const network = () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

  it('offline: decides on the device and queues the session', async () => {
    network();
    const s = await submitTriage({
      patientId: '665f00000000000000000a01',
      input: adult(['chest_pain']),
      online: false,
      predictor: null,
    });
    expect(s).toMatchObject({ syncStatus: 'pending', level: 'EMERGENCY', source: 'rules' });
    expect(await db.sessions.where('syncStatus').equals('pending').count()).toBe(1);
  });

  it('online but the request fails: falls back to the device', async () => {
    network();
    const s = await submitTriage({
      patientId: '665f00000000000000000a01',
      input: adult(['cough']),
      online: true,
      predictor: null,
    });
    expect(s.syncStatus).toBe('pending');
  });

  it('sync marks sessions synced and records a changed server verdict', async () => {
    network();
    const a = await submitTriage({
      patientId: '665f00000000000000000a01',
      input: adult(['cough']),
      online: false,
      predictor: null,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.sessions[0]).toMatchObject({
        clientId: a.clientId,
        clientResult: { level: 'SEE_DOCTOR_SOON', source: 'rule_engine_fallback' },
      });
      return new Response(
        JSON.stringify({
          results: [
            {
              clientId: a.clientId,
              status: 'created',
              sessionId: 'x'.repeat(24),
              level: 'EMERGENCY',
              verdictChanged: true,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const summary = await syncPending();
    expect(summary).toMatchObject({ sent: 1, synced: 1, changed: 1, failed: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await db.sessions.get(a.clientId)).toMatchObject({
      syncStatus: 'synced',
      serverLevel: 'EMERGENCY',
      verdictChanged: true,
    });
  });

  it('network failure: keeps the session and backs off', async () => {
    network();
    const a = await submitTriage({
      patientId: '665f00000000000000000a01',
      input: adult(['cough']),
      online: false,
      predictor: null,
    });
    const now = Date.now();
    expect(await syncPending(now)).toMatchObject({ sent: 1, failed: true });
    const after = await db.sessions.get(a.clientId);
    expect(after).toMatchObject({ syncStatus: 'pending', attempts: 1 });
    expect(after!.nextAttemptAt).toBe(now + backoffMs(1));
    // not retried before the backoff expires
    expect(await syncPending(now + 1000)).toMatchObject({ sent: 0 });
  });

  it('backoff grows and is capped at 5 minutes', () => {
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([5000, 10000, 20000, 300000]);
  });
});

describe('updateModel', () => {
  const sha = createHash('sha256').update(modelBytes).digest('hex');
  const files = (bytes: Buffer = modelBytes) =>
    vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('.json')
        ? new Response(JSON.stringify(metadataJson), { status: 200 })
        : new Response(new Uint8Array(bytes), { status: 200 }),
    ) as unknown as typeof fetch;

  it('downloads the model the first time and verifies its sha256', async () => {
    const fetchFn = files();
    const r = await updateModel({ remoteVersion: async () => ({ sha256: sha }), fetchFn });
    expect(r).toMatchObject({ status: 'updated', metadata: { sha256: sha } });
    expect((await db.model.get('current'))!.metadata.modelVersion).toBe(metadata.modelVersion);
  });

  it('does not download again when the server hash is unchanged', async () => {
    await updateModel({ remoteVersion: async () => ({ sha256: sha }), fetchFn: files() });
    const fetchFn = files();
    expect(await updateModel({ remoteVersion: async () => ({ sha256: sha }), fetchFn })).toMatchObject({
      status: 'current',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a corrupted download and keeps having no model', async () => {
    const corrupted = Buffer.concat([modelBytes, Buffer.from([0])]);
    const r = await updateModel({ remoteVersion: async () => ({ sha256: sha }), fetchFn: files(corrupted) });
    expect(r).toMatchObject({ status: 'unavailable' });
    expect(await db.model.get('current')).toBeUndefined();
  });

  it('keeps the stored model when the server cannot be reached', async () => {
    await updateModel({ remoteVersion: async () => ({ sha256: sha }), fetchFn: files() });
    const fetchFn = files();
    expect(await updateModel({ remoteVersion: async () => null, fetchFn })).toMatchObject({
      status: 'current',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
