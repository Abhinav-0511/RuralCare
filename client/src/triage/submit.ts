import type { TriageContext, TriageLevelId } from '@ruralcare/shared';
import { api, NetworkError } from '../lib/api';
import { db, type GuidanceView, type LocalSession, type ResultSource } from '../lib/db';
import type { Predictor } from '../model/modelManager';
import { runLocalTriage } from './localTriage';

export function uuid(): string {
  // randomUUID only exists in secure contexts (https/localhost), not on a plain-http LAN address.
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface TriageResponse {
  session: {
    id: string;
    result: {
      level: TriageLevelId;
      source: 'rule_engine' | 'model' | 'rule_engine_fallback';
      rulesVersion: string;
      model: { modelVersion?: string };
    };
  };
  guidance: GuidanceView;
}

export const serverSourceToView = (s: TriageResponse['session']['result']['source']): ResultSource =>
  s === 'model' ? 'online_model' : s === 'rule_engine' ? 'rules' : 'rules_only';

export const SESSION_SAVED_EVENT = 'ruralcare:session-saved';

/**
 * Online: the server decides (its rules, device vitals, online model). If the server can't be
 * reached, the device decides with the same rules + offline model and queues the session for sync.
 */
export async function submitTriage(args: {
  patientId: string;
  patientName?: string;
  input: TriageContext;
  online: boolean;
  predictor: Predictor | null;
}): Promise<LocalSession> {
  const clientId = uuid();
  const createdAt = new Date().toISOString();
  const base = { clientId, patientId: args.patientId, createdAt, input: args.input, attempts: 0 };
  const withName = args.patientName ? { patientName: args.patientName } : {};

  if (args.online) {
    try {
      const res = await api<TriageResponse>('/api/triage', {
        method: 'POST',
        body: { clientId, patientId: args.patientId, input: args.input },
        timeoutMs: 20_000,
      });
      const r = res.session.result;
      const session: LocalSession = {
        ...base,
        ...withName,
        level: r.level,
        source: serverSourceToView(r.source),
        rulesVersion: r.rulesVersion,
        ...(r.model.modelVersion ? { modelVersion: r.model.modelVersion } : {}),
        guidance: res.guidance,
        syncStatus: 'synced',
        serverSessionId: res.session.id,
        serverLevel: r.level,
      };
      await db.sessions.put(session);
      return session;
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
    }
  }

  const local = await runLocalTriage(args.input, args.predictor);
  const session: LocalSession = {
    ...base,
    ...withName,
    level: local.decision.level,
    source: local.source,
    rulesVersion: local.decision.rulesVersion,
    ...(local.modelVersion ? { modelVersion: local.modelVersion } : {}),
    guidance: local.guidance,
    syncStatus: 'pending',
  };
  await db.sessions.put(session);
  window.dispatchEvent(new Event(SESSION_SAVED_EVENT));
  return session;
}
