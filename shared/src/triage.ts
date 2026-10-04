import type { RedFlagResult } from './redFlags';
import { type NonEmergencyLevelId, TRIAGE_LEVELS, type TriageLevelId } from './schemas';

/** Higher number = more severe. */
export const severityOf = (level: TriageLevelId): number =>
  TRIAGE_LEVELS.length - TRIAGE_LEVELS.indexOf(level);

export function mostSevere<L extends TriageLevelId>(a: L, b: TriageLevelId | null): TriageLevelId {
  return b !== null && severityOf(b) > severityOf(a) ? b : a;
}

export interface ModelPrediction {
  level: NonEmergencyLevelId;
  confidence: number;
  modelVersion: string;
  topConditions: { id: string; probability: number }[];
  /** Top-1 probability was below the policy threshold (the level was raised to at least SEE_DOCTOR_SOON). */
  lowConfidence?: boolean;
}

export type ModelOutcome =
  | { status: 'ok'; prediction: ModelPrediction }
  | { status: 'unavailable'; reason: string }
  /** The AI service's own red-flag check (defence in depth) found an emergency the caller's didn't. */
  | { status: 'rules_emergency'; redFlags: string[] };

export type TriageSource = 'rule_engine' | 'model' | 'rule_engine_fallback';

export interface TriageDecision {
  level: TriageLevelId;
  /** Who decided: a red-flag rule, the model, or the rules-only fallback because the model was unavailable. */
  source: TriageSource;
  redFlags: string[];
  /** Safety floors that matched (they may have raised the level above the model's output). */
  safetyFloors: string[];
  model:
    | { status: 'not_called' }
    | { status: 'unavailable'; reason: string }
    | ({ status: 'ok' } & ModelPrediction);
  rulesVersion: string;
}

/**
 * Combines the red-flag result with the model outcome. Used online (server) and offline (client)
 * so both paths reach the same decision.
 *
 * - Red flag matched      => EMERGENCY; the model must not have been called (pass `null`).
 * - Model ok              => model level, raised to the safety floor if one matched.
 * - Model unavailable     => `fallbackLevel` (never SELF_CARE), raised to the safety floor.
 */
export function decideTriage(
  redFlags: RedFlagResult,
  model: ModelOutcome | null,
  fallbackLevel: Exclude<NonEmergencyLevelId, 'SELF_CARE'>,
): TriageDecision {
  const base = {
    redFlags: redFlags.matchedRules.map((r) => r.id),
    safetyFloors: redFlags.matchedFloors.map((f) => f.id),
    rulesVersion: redFlags.rulesVersion,
  };

  if (redFlags.isEmergency) {
    return { ...base, level: 'EMERGENCY', source: 'rule_engine', model: { status: 'not_called' } };
  }

  if (model?.status === 'rules_emergency') {
    // Only possible if the two rule sets differ (e.g. different versions deployed): the safer answer wins.
    return {
      ...base,
      redFlags: [...new Set([...base.redFlags, ...model.redFlags])],
      level: 'EMERGENCY',
      source: 'rule_engine',
      model: { status: 'not_called' },
    };
  }

  if (model?.status === 'ok') {
    return {
      ...base,
      level: mostSevere(model.prediction.level, redFlags.minimumLevel),
      source: 'model',
      model: { status: 'ok', ...model.prediction },
    };
  }

  return {
    ...base,
    level: mostSevere(fallbackLevel, redFlags.minimumLevel),
    source: 'rule_engine_fallback',
    model: { status: 'unavailable', reason: model?.reason ?? 'model not called' },
  };
}
