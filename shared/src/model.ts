// Model input/output helpers shared by the server tests, the ONNX parity test and (Phase 5) the
// in-browser model. The Python ai-service has a line-for-line port in app/model/policy.py; both are
// tested against shared/tests/prediction_policy_cases.json.
import { conditionsFile, getCondition } from './data';
import { normalizeSymptomId } from './redFlags';
import type { NonEmergencyLevelId, PredictionPolicy, TriageLevelId } from './schemas';
import { mostSevere } from './triage';

export interface FeatureVector {
  vector: Float32Array;
  /** Input symptoms that are model features. */
  knownFeatureCount: number;
  /** Input symptoms the model has no feature for (it can't judge them). */
  unmodelledSymptoms: string[];
}

export function buildFeatureVector(symptoms: readonly string[], features: readonly string[]): FeatureVector {
  const index = new Map(features.map((f, i) => [f, i]));
  const vector = new Float32Array(features.length);
  const unmodelledSymptoms: string[] = [];
  for (const raw of new Set(symptoms.map(normalizeSymptomId))) {
    const i = index.get(raw);
    if (i === undefined) unmodelledSymptoms.push(raw);
    else vector[i] = 1;
  }
  return {
    vector,
    knownFeatureCount: features.length ? vector.reduce((a, b) => a + b, 0) : 0,
    unmodelledSymptoms,
  };
}

export interface RankedCondition {
  id: string;
  probability: number;
}

/** All classes sorted by probability (highest first); ties keep class order. */
export function rankConditions(
  probabilities: ArrayLike<number>,
  classes: readonly string[],
): RankedCondition[] {
  return classes
    .map((id, i) => ({ id, probability: Number(probabilities[i] ?? 0), i }))
    .sort((a, b) => b.probability - a.probability || a.i - b.i)
    .map(({ id, probability }) => ({ id, probability }));
}

export interface PolicyResult {
  level: NonEmergencyLevelId;
  lowConfidence: boolean;
}

/**
 * Turns ranked model output into a triage level (see `policy.notes` in conditions.json).
 * Never returns SELF_CARE when confidence is low or the model couldn't see every symptom.
 */
export function predictionLevel(
  ranked: readonly RankedCondition[],
  input: { knownFeatureCount: number; unmodelledSymptoms: readonly string[] },
  policy: PredictionPolicy = conditionsFile.policy,
): PolicyResult {
  const top = ranked[0];
  if (input.knownFeatureCount === 0 || !top) return { level: 'SEE_DOCTOR_SOON', lowConfidence: true };

  let level: TriageLevelId = getCondition(top.id).triageLevel;
  for (const runnerUp of ranked.slice(1, policy.topK)) {
    if (runnerUp.probability >= policy.escalateRunnerUpMinProbability) {
      level = mostSevere(level, getCondition(runnerUp.id).triageLevel);
    }
  }
  const lowConfidence = top.probability < policy.minConfidence;
  if (lowConfidence || input.unmodelledSymptoms.length > 0) level = mostSevere(level, 'SEE_DOCTOR_SOON');
  return { level: level as NonEmergencyLevelId, lowConfidence };
}
