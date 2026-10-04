import {
  buildGuidance,
  decideTriage,
  MODEL_UNAVAILABLE_FALLBACK_LEVEL,
  type ModelOutcome,
  normalizeSymptomId,
  redFlagEngine,
  type TriageContext,
  type TriageDecision,
} from '@ruralcare/shared';
import type { HydratedDocument } from 'mongoose';
import { conflict } from '../lib/httpError';
import { type SessionResult, TriageSession, type TriageSessionFields } from '../models/triageSession';
import type { AiClient } from './aiClient';

/**
 * Safety order: red-flag rules first. If one matches, the model is NOT called.
 * Otherwise ask the model; if it's unavailable, fall back to rules-only (never SELF_CARE).
 */
export async function evaluateTriage(input: TriageContext, ai: AiClient): Promise<TriageDecision> {
  const redFlags = redFlagEngine.evaluate(input);
  if (redFlags.isEmergency) return decideTriage(redFlags, null, MODEL_UNAVAILABLE_FALLBACK_LEVEL);
  let model: ModelOutcome;
  try {
    model = await ai.predict(input);
  } catch {
    // AiClient.predict shouldn't throw, but triage must never fail because of the model.
    model = { status: 'unavailable', reason: 'AI client error' };
  }
  return decideTriage(redFlags, model, MODEL_UNAVAILABLE_FALLBACK_LEVEL);
}

/** Lower-cases, trims and de-duplicates symptom ids before storage. */
export const normalizeInput = <T extends TriageContext>(input: T): T => ({
  ...input,
  symptoms: [...new Set(input.symptoms.map(normalizeSymptomId))],
});

export function decisionToResult(decision: TriageDecision): SessionResult {
  const { model } = decision;
  return {
    level: decision.level,
    source: decision.source,
    redFlags: decision.redFlags,
    safetyFloors: decision.safetyFloors,
    rulesVersion: decision.rulesVersion,
    model:
      model.status === 'ok'
        ? {
            status: 'ok',
            modelVersion: model.modelVersion,
            confidence: model.confidence,
            lowConfidence: model.lowConfidence ?? false,
            topConditions: model.topConditions,
          }
        : model.status === 'unavailable'
          ? { status: 'unavailable', reason: model.reason, topConditions: [] }
          : { status: 'not_called', topConditions: [] },
  };
}

type SessionDoc = HydratedDocument<TriageSessionFields>;

/**
 * Looks up a session by its client-generated id. If it exists for a DIFFERENT patient the id
 * is a collision (or tampering): refuse rather than leak or overwrite.
 */
export async function findExistingSession(clientId: string, patientId: string): Promise<SessionDoc | null> {
  const existing = await TriageSession.findOne({ clientId });
  if (existing && String(existing.patientId) !== patientId) {
    throw conflict('CLIENT_ID_CONFLICT', 'clientId is already used by another session');
  }
  return existing;
}

/**
 * Inserts the session, relying on the unique clientId index for idempotency. If two identical
 * requests race, the loser gets the winner's document back instead of a duplicate.
 */
export async function insertSessionIdempotent(
  doc: Omit<TriageSessionFields, 'createdAt' | 'updatedAt' | 'review' | 'verdictChanged'> & {
    verdictChanged?: boolean;
  },
): Promise<{ session: SessionDoc; duplicate: boolean }> {
  try {
    return { session: await TriageSession.create(doc), duplicate: false };
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const existing = await findExistingSession(doc.clientId, String(doc.patientId));
    if (!existing) throw err;
    return { session: existing, duplicate: true };
  }
}

export function toSessionResponse(session: SessionDoc) {
  return {
    session: session.toJSON(),
    guidance: buildGuidance(session.result, session.result.model.topConditions),
  };
}
