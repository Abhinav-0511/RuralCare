// Triage without an account. Same wizard, rules, floors and model; the result stays on this device.
import type { TriageContext, TriageLevelId } from '@ruralcare/shared';
import { api, ApiError, NetworkError } from '../lib/api';
import { db, type GuestCheck, type GuidanceView } from '../lib/db';
import type { Predictor } from '../model/modelManager';
import { runLocalTriage } from './localTriage';
import { serverSourceToView, uuid } from './submit';

interface GuestTriageResponse {
  result: {
    level: TriageLevelId;
    source: 'rule_engine' | 'model' | 'rule_engine_fallback';
    rulesVersion: string;
    model: { modelVersion?: string };
  };
  guidance: GuidanceView;
  stored: false;
}

/**
 * Online: the public guest endpoint computes the result (it stores nothing). Offline, or if that
 * endpoint is busy (rate limit) or down, the device decides with the same shared rules and model.
 * Either way the check is saved only in this device's guestChecks table, never in the sync outbox.
 */
export async function submitGuestTriage(args: {
  input: TriageContext;
  online: boolean;
  predictor: Predictor | null;
}): Promise<GuestCheck> {
  const base = { clientId: uuid(), createdAt: new Date().toISOString(), input: args.input };

  if (args.online) {
    try {
      const res = await api<GuestTriageResponse>('/api/guest/triage', {
        method: 'POST',
        body: { input: args.input },
        auth: false,
        timeoutMs: 20_000,
      });
      const check: GuestCheck = {
        ...base,
        level: res.result.level,
        source: serverSourceToView(res.result.source),
        rulesVersion: res.result.rulesVersion,
        ...(res.result.model.modelVersion ? { modelVersion: res.result.model.modelVersion } : {}),
        guidance: res.guidance,
      };
      await db.guestChecks.put(check);
      return check;
    } catch (err) {
      // A guest must always get an answer: fall back to the device on network trouble, 429 or 5xx.
      const recoverable =
        err instanceof NetworkError || (err instanceof ApiError && (err.status === 429 || err.status >= 500));
      if (!recoverable) throw err;
    }
  }

  const local = await runLocalTriage(args.input, args.predictor);
  const check: GuestCheck = {
    ...base,
    level: local.decision.level,
    source: local.source,
    rulesVersion: local.decision.rulesVersion,
    ...(local.modelVersion ? { modelVersion: local.modelVersion } : {}),
    guidance: local.guidance,
  };
  await db.guestChecks.put(check);
  return check;
}

interface ClaimResult {
  clientId: string;
  status: 'created' | 'duplicate' | 'rejected';
  sessionId?: string;
  level?: TriageLevelId;
  verdictChanged?: boolean;
}

/**
 * Adds this device's guest checks to the logged-in patient's record (POST /api/triage/guest-claims).
 * Accepted checks move from guestChecks to the patient's history; rejected ones stay on the device.
 */
export async function claimGuestChecks(patient: { patientId: string; patientName?: string }) {
  const checks = await db.guestChecks.orderBy('createdAt').toArray();
  let added = 0;
  for (let i = 0; i < checks.length; i += 50) {
    const batch = checks.slice(i, i + 50);
    const { results } = await api<{ results: ClaimResult[] }>('/api/triage/guest-claims', {
      method: 'POST',
      body: {
        sessions: batch.map((c) => ({
          clientId: c.clientId,
          clientCreatedAt: c.createdAt,
          input: c.input,
          clientResult: {
            level: c.level,
            source:
              c.source === 'rules'
                ? 'rule_engine'
                : c.source === 'rules_only'
                  ? 'rule_engine_fallback'
                  : 'model',
            rulesVersion: c.rulesVersion,
            ...(c.modelVersion ? { modelVersion: c.modelVersion } : {}),
          },
        })),
      },
    });
    await db.transaction('rw', db.guestChecks, db.sessions, async () => {
      for (const r of results) {
        const c = batch.find((x) => x.clientId === r.clientId);
        if (!c || r.status === 'rejected') continue;
        await db.sessions.put({
          ...c,
          patientId: patient.patientId,
          ...(patient.patientName ? { patientName: patient.patientName } : {}),
          syncStatus: 'synced',
          attempts: 0,
          ...(r.sessionId ? { serverSessionId: r.sessionId } : {}),
          ...(r.level ? { serverLevel: r.level } : {}),
          ...(r.verdictChanged ? { verdictChanged: true } : {}),
        });
        await db.guestChecks.delete(c.clientId);
        added += 1;
      }
    });
  }
  return { added, total: checks.length };
}

/** Remembers, per user and device, that the "add earlier checks?" question was answered. */
const promptKey = (userId: string) => `ruralcare.guestPrompt.${userId}`;
export const guestPromptAnswered = (userId: string) => {
  try {
    return localStorage.getItem(promptKey(userId)) !== null;
  } catch {
    return false;
  }
};
export const markGuestPromptAnswered = (userId: string, answer: 'added' | 'declined') => {
  try {
    localStorage.setItem(promptKey(userId), answer);
  } catch {
    // storage unavailable: the question may be asked again, which is harmless
  }
};
