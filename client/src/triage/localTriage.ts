// Offline triage on the device: the same shared rules, floors, policy and decideTriage() as the server.
import {
  buildFeatureVector,
  buildGuidance,
  conditionsFile,
  decideTriage,
  MODEL_UNAVAILABLE_FALLBACK_LEVEL,
  type ModelOutcome,
  predictionLevel,
  rankConditions,
  redFlagEngine,
  type TriageContext,
  type TriageDecision,
} from '@ruralcare/shared';
import type { GuidanceView, ResultSource } from '../lib/db';
import type { Predictor } from '../model/modelManager';

export interface LocalResult {
  decision: TriageDecision;
  guidance: GuidanceView;
  source: ResultSource;
  modelVersion?: string;
}

export async function runLocalTriage(
  input: TriageContext,
  predictor: Predictor | null,
): Promise<LocalResult> {
  const redFlags = redFlagEngine.evaluate(input);
  let model: ModelOutcome | null = null;

  if (!redFlags.isEmergency) {
    if (!predictor) {
      model = { status: 'unavailable', reason: 'No AI model on this device yet' };
    } else {
      try {
        const { metadata } = predictor;
        const fv = buildFeatureVector(input.symptoms, metadata.features);
        const ranked = rankConditions(await predictor.predict(fv.vector), metadata.classes);
        const policy = predictionLevel(ranked, fv);
        const known = fv.knownFeatureCount > 0;
        model = {
          status: 'ok',
          prediction: {
            level: policy.level,
            confidence: known ? ranked[0]!.probability : 0,
            lowConfidence: policy.lowConfidence,
            modelVersion: metadata.modelVersion,
            topConditions: known ? ranked.slice(0, conditionsFile.policy.topK) : [],
          },
        };
      } catch (err) {
        model = { status: 'unavailable', reason: (err as Error).message };
      }
    }
  }

  const decision = decideTriage(redFlags, model, MODEL_UNAVAILABLE_FALLBACK_LEVEL);
  const topConditions = decision.model.status === 'ok' ? decision.model.topConditions : [];
  return {
    decision,
    guidance: buildGuidance(decision, topConditions),
    source:
      decision.source === 'model'
        ? 'offline_model'
        : decision.source === 'rule_engine'
          ? 'rules'
          : 'rules_only',
    ...(decision.model.status === 'ok' ? { modelVersion: decision.model.modelVersion } : {}),
  };
}
