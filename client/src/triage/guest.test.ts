// @vitest-environment node
// Triage without an account: on-device only, never in the sync outbox, same rules as everyone.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../lib/api';
import { db } from '../lib/db';
import { claimGuestChecks, guestPromptAnswered, markGuestPromptAnswered, submitGuestTriage } from './guest';
import { syncPending } from './sync';

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

const adult = (symptoms: string[], extra = {}) => ({ symptoms, ageMonths: 420, ...extra });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  storage.clear();
  await Promise.all([db.sessions.clear(), db.guestChecks.clear()]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('guest triage', () => {
  it('offline: red flags still give EMERGENCY from the rules, without a model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const check = await submitGuestTriage({ input: adult(['chest_pain']), online: false, predictor: null });
    expect(check).toMatchObject({ level: 'EMERGENCY', source: 'rules' });
    expect(check.guidance.title.en).toContain('108');
    expect(check.guidance.disclaimer.en).toContain('not a medical diagnosis');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('offline: the same safety floors apply (severe symptoms => at least SEE_DOCTOR_24H)', async () => {
    const check = await submitGuestTriage({
      input: adult(['runny_nose'], { severity: 'severe' }),
      online: false,
      predictor: null,
    });
    expect(check.level).toBe('SEE_DOCTOR_24H');
  });

  it('is stored only in guestChecks, never in the sync outbox, and sync never sends it', async () => {
    tokenStore.set({ accessToken: 'a', refreshToken: 'r' });
    const check = await submitGuestTriage({ input: adult(['cough']), online: false, predictor: null });
    expect(await db.guestChecks.get(check.clientId)).toBeDefined();
    expect(await db.sessions.count()).toBe(0);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { results: [] }));
    await syncPending();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('online: uses the public guest endpoint without any token', async () => {
    tokenStore.set({ accessToken: 'secret-token', refreshToken: 'r' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, {
        result: { level: 'SELF_CARE', source: 'model', rulesVersion: '1.2.0', model: { modelVersion: 'm1' } },
        guidance: { title: { en: 'x' }, advice: {}, disclaimer: {}, reasons: [], possibleConditions: [] },
        stored: false,
      }),
    );
    const check = await submitGuestTriage({ input: adult(['cough']), online: true, predictor: null });
    expect(check).toMatchObject({ level: 'SELF_CARE', source: 'online_model', modelVersion: 'm1' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/guest\/triage$/);
    expect(JSON.stringify(init?.headers ?? {})).not.toContain('secret-token');
  });

  it('online but rate-limited or server down: still answers on the device', async () => {
    for (const status of [429, 503]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(status, { error: { code: 'X', message: 'x' } }));
      const check = await submitGuestTriage({ input: adult(['chest_pain']), online: true, predictor: null });
      expect(check).toMatchObject({ level: 'EMERGENCY', source: 'rules' });
      vi.restoreAllMocks();
    }
  });
});

describe('adding guest checks to a record', () => {
  it('moves accepted checks into the patient history and keeps rejected ones on the device', async () => {
    const a = await submitGuestTriage({ input: adult(['chest_pain']), online: false, predictor: null });
    const b = await submitGuestTriage({ input: adult(['cough']), online: false, predictor: null });
    tokenStore.set({ accessToken: 'a', refreshToken: 'r' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, {
        results: [
          { clientId: a.clientId, status: 'created', sessionId: 's1', level: 'EMERGENCY' },
          { clientId: b.clientId, status: 'rejected', error: { code: 'X', message: 'x' } },
        ],
      }),
    );

    const res = await claimGuestChecks({ patientId: 'p1', patientName: 'Kaveri' });
    expect(res).toEqual({ added: 1, total: 2 });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/triage\/guest-claims$/);
    const body = JSON.parse(String(init!.body));
    expect(body.sessions).toHaveLength(2);
    const sentA = body.sessions.find((x: { clientId: string }) => x.clientId === a.clientId);
    expect(sentA).not.toHaveProperty('patientId'); // the server uses the logged-in patient
    expect(sentA.clientResult).toMatchObject({ level: 'EMERGENCY', source: 'rule_engine' });

    expect(await db.sessions.get(a.clientId)).toMatchObject({
      patientId: 'p1',
      syncStatus: 'synced',
      serverSessionId: 's1',
    });
    expect(await db.guestChecks.get(a.clientId)).toBeUndefined();
    expect(await db.guestChecks.get(b.clientId)).toBeDefined();
  });

  it('remembers the answer per user', () => {
    expect(guestPromptAnswered('u1')).toBe(false);
    markGuestPromptAnswered('u1', 'declined');
    expect(guestPromptAnswered('u1')).toBe(true);
    expect(guestPromptAnswered('u2')).toBe(false);
  });
});
