import type { TriageLevelId } from '@ruralcare/shared';
import { api, ApiError } from '../lib/api';
import { db, type LocalSession, type ResultSource } from '../lib/db';

interface SyncResult {
  clientId: string;
  status: 'created' | 'duplicate' | 'rejected';
  sessionId?: string;
  level?: TriageLevelId;
  verdictChanged?: boolean;
  error?: { code: string; message: string };
}

export interface SyncSummary {
  sent: number;
  synced: number;
  rejected: number;
  changed: number;
  failed: boolean;
}

const BATCH = 50;
/** 5 s, 10 s, 20 s ... capped at 5 minutes. */
export const backoffMs = (attempts: number) => Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

const toServerSource = (s: ResultSource) =>
  s === 'online_model' || s === 'offline_model'
    ? 'model'
    : s === 'rules'
      ? 'rule_engine'
      : 'rule_engine_fallback';

export function toSyncItem(s: LocalSession) {
  return {
    clientId: s.clientId,
    patientId: s.patientId,
    clientCreatedAt: s.createdAt,
    input: s.input,
    clientResult: {
      level: s.level,
      source: toServerSource(s.source),
      rulesVersion: s.rulesVersion,
      ...(s.modelVersion ? { modelVersion: s.modelVersion } : {}),
    },
  };
}

/** Uploads due pending sessions. Safe to call any time: the server is idempotent per clientId. */
export async function syncPending(now = Date.now()): Promise<SyncSummary> {
  const due = await db.sessions
    .where('syncStatus')
    .equals('pending')
    .filter((s) => !s.nextAttemptAt || s.nextAttemptAt <= now)
    .limit(BATCH)
    .toArray();
  const summary: SyncSummary = { sent: due.length, synced: 0, rejected: 0, changed: 0, failed: false };
  if (!due.length) return summary;

  let results: SyncResult[];
  try {
    ({ results } = await api<{ results: SyncResult[] }>('/api/triage/sync', {
      method: 'POST',
      body: { sessions: due.map(toSyncItem) },
      timeoutMs: 30_000,
    }));
  } catch (err) {
    // Offline, server down, or a validation problem: retry later with backoff.
    await db.transaction('rw', db.sessions, async () => {
      for (const s of due) {
        const attempts = s.attempts + 1;
        await db.sessions.update(s.clientId, {
          attempts,
          nextAttemptAt: now + backoffMs(attempts),
          lastError: err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message,
        });
      }
    });
    return { ...summary, failed: true };
  }

  await db.transaction('rw', db.sessions, async () => {
    for (const r of results) {
      if (r.status === 'rejected') {
        summary.rejected += 1;
        await db.sessions.update(r.clientId, {
          syncStatus: 'rejected',
          lastError: r.error ? `${r.error.code}: ${r.error.message}` : 'rejected',
        });
        continue;
      }
      summary.synced += 1;
      if (r.verdictChanged) summary.changed += 1;
      await db.sessions.update(r.clientId, {
        syncStatus: 'synced',
        ...(r.sessionId ? { serverSessionId: r.sessionId } : {}),
        ...(r.level ? { serverLevel: r.level } : {}),
        verdictChanged: Boolean(r.verdictChanged),
      });
    }
  });
  return summary;
}
