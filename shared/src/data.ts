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

export const symptomVocabulary = SymptomVocabularySchema.parse(symptomsJson);
export const triageLevels = TriageLevelsFileSchema.parse(triageLevelsJson);
export const redFlagEngine = createRedFlagEngine(redFlagsJson, symptomsJson);

export const EMERGENCY_NUMBER = triageLevels.emergencyNumber;

export function getTriageLevel(id: TriageLevelId): TriageLevel {
  const level = triageLevels.levels.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown triage level ${id}`);
  return level;
}

export const localize = (text: LocalizedText, locale: Locale): string => text[locale] ?? text.en;

export const getDisclaimer = (locale: Locale): string => localize(triageLevels.disclaimer, locale);
