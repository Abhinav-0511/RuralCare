// Loads the shared JSON data. Validated once at import time, so an invalid data file fails fast.
import redFlagsJson from '../data/red_flags.json';
import symptomsJson from '../data/symptoms.json';
import triageLevelsJson from '../data/triage_levels.json';
import { createRedFlagEngine } from './redFlags';
import {
  type Locale,
  type LocalizedText,
  SymptomVocabularySchema,
  type TriageLevel,
  type TriageLevelId,
  TriageLevelsFileSchema,
} from './schemas';
import type { TriageDecision } from './triage';

export const symptomVocabulary = SymptomVocabularySchema.parse(symptomsJson);
export const triageLevels = TriageLevelsFileSchema.parse(triageLevelsJson);
export const redFlagEngine = createRedFlagEngine(redFlagsJson, symptomsJson);

export const EMERGENCY_NUMBER = triageLevels.emergencyNumber;
export const MODEL_UNAVAILABLE_FALLBACK_LEVEL = triageLevels.modelUnavailable.fallbackLevel;

export function getTriageLevel(id: TriageLevelId): TriageLevel {
  const level = triageLevels.levels.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown triage level ${id}`);
  return level;
}

export const localize = (text: LocalizedText, locale: Locale): string => text[locale] ?? text.en;

export const getDisclaimer = (locale: Locale): string => localize(triageLevels.disclaimer, locale);

export interface TriageGuidance {
  title: LocalizedText;
  advice: LocalizedText;
  /** Always present: triage guidance, not a diagnosis. */
  disclaimer: LocalizedText;
  /** Present when the model was unavailable and the result came from the rules-only fallback. */
  notice?: LocalizedText;
  /** Labels of the red flags / safety floors that drove the result. */
  reasons: LocalizedText[];
}

/** Everything the UI needs to show a result, in every supported language. */
export function buildGuidance(
  decision: Pick<TriageDecision, 'level' | 'source' | 'redFlags' | 'safetyFloors'>,
): TriageGuidance {
  const level = getTriageLevel(decision.level);
  const reasons = [
    ...redFlagEngine.rules.filter((r) => decision.redFlags.includes(r.id)),
    ...redFlagEngine.floors.filter((f) => decision.safetyFloors.includes(f.id)),
  ].map((r) => r.label);
  return {
    title: level.title,
    advice: level.advice,
    disclaimer: triageLevels.disclaimer,
    ...(decision.source === 'rule_engine_fallback' ? { notice: triageLevels.modelUnavailable.notice } : {}),
    reasons,
  };
}
