import {
  type Condition,
  type RedFlagRule,
  RedFlagRuleSetSchema,
  type SafetyFloor,
  SymptomVocabularySchema,
  type TriageContext,
  TRIAGE_LEVELS,
  type TriageLevelId,
} from './schemas';

export interface RedFlagResult {
  isEmergency: boolean;
  /** 'EMERGENCY' when any rule matched, otherwise null (the ML model decides). */
  level: 'EMERGENCY' | null;
  /** Matched rules, in rule-file order. */
  matchedRules: RedFlagRule[];
  /** Matched safety floors (minimum levels), in file order. */
  matchedFloors: SafetyFloor[];
  /**
   * The lowest level the final result may have: EMERGENCY if a rule matched, otherwise the
   * highest matched floor, otherwise null (no constraint).
   */
  minimumLevel: TriageLevelId | null;
  /** Input symptoms that are not in the vocabulary (ignored for matching). */
  unknownSymptoms: string[];
  rulesVersion: string;
}

export interface RedFlagEngine {
  readonly rulesVersion: string;
  readonly rules: readonly RedFlagRule[];
  readonly floors: readonly SafetyFloor[];
  evaluate(ctx: TriageContext): RedFlagResult;
}

interface NormalizedContext {
  symptoms: Set<string>;
  ageMonths: number | null;
  pregnant: boolean | null;
  temperatureC: number | null;
}

const finiteOrNull = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

/** Lower-cases and trims symptom ids so " Chest_Pain " matches "chest_pain". */
export const normalizeSymptomId = (s: string): string => s.trim().toLowerCase();

function evaluateCondition(c: Condition, ctx: NormalizedContext): boolean {
  if ('anySymptoms' in c) return c.anySymptoms.some((s) => ctx.symptoms.has(s));
  if ('allSymptoms' in c) return c.allSymptoms.every((s) => ctx.symptoms.has(s));
  // Missing context values never match: an unknown age can't trigger an infant rule.
  if ('ageMonthsLt' in c) return ctx.ageMonths !== null && ctx.ageMonths < c.ageMonthsLt;
  if ('ageMonthsGte' in c) return ctx.ageMonths !== null && ctx.ageMonths >= c.ageMonthsGte;
  if ('ageKnown' in c) return (ctx.ageMonths !== null) === c.ageKnown;
  if ('pregnant' in c) return ctx.pregnant !== null && ctx.pregnant === c.pregnant;
  if ('temperatureCGte' in c) return ctx.temperatureC !== null && ctx.temperatureC >= c.temperatureCGte;
  if ('all' in c) return c.all.every((sub) => evaluateCondition(sub, ctx));
  if ('any' in c) return c.any.some((sub) => evaluateCondition(sub, ctx));
  throw new Error(`Unknown red-flag condition: ${JSON.stringify(c)}`);
}

function referencedSymptoms(c: Condition): string[] {
  if ('anySymptoms' in c) return c.anySymptoms;
  if ('allSymptoms' in c) return c.allSymptoms;
  if ('all' in c) return c.all.flatMap(referencedSymptoms);
  if ('any' in c) return c.any.flatMap(referencedSymptoms);
  return [];
}

/**
 * Builds a red-flag engine from raw JSON. Throws if the rules are malformed, a rule id is
 * duplicated, or a rule references a symptom that isn't in the vocabulary. A broken rule file
 * must stop the app loudly rather than silently skip emergencies.
 */
export function createRedFlagEngine(rawRules: unknown, rawVocabulary: unknown): RedFlagEngine {
  const ruleSet = RedFlagRuleSetSchema.parse(rawRules);
  const vocabulary = SymptomVocabularySchema.parse(rawVocabulary);
  const known = new Set(vocabulary.symptoms.map((s) => s.id));

  const ids = new Set<string>();
  for (const rule of [...ruleSet.rules, ...ruleSet.floors]) {
    if (ids.has(rule.id)) throw new Error(`Duplicate red-flag rule id: ${rule.id}`);
    ids.add(rule.id);
    for (const s of referencedSymptoms(rule.when)) {
      if (!known.has(s)) throw new Error(`Rule ${rule.id} references unknown symptom "${s}"`);
    }
  }

  return {
    rulesVersion: ruleSet.version,
    rules: ruleSet.rules,
    floors: ruleSet.floors,
    evaluate(input) {
      const symptoms = new Set<string>();
      const unknownSymptoms: string[] = [];
      for (const raw of input.symptoms) {
        const id = normalizeSymptomId(raw);
        if (known.has(id)) symptoms.add(id);
        else if (!unknownSymptoms.includes(id)) unknownSymptoms.push(id);
      }
      const ctx: NormalizedContext = {
        symptoms,
        ageMonths: finiteOrNull(input.ageMonths),
        pregnant: typeof input.pregnant === 'boolean' ? input.pregnant : null,
        temperatureC: finiteOrNull(input.temperatureC),
      };

      const matchedRules = ruleSet.rules.filter((rule) => evaluateCondition(rule.when, ctx));
      const matchedFloors = ruleSet.floors.filter((floor) => evaluateCondition(floor.when, ctx));
      const isEmergency = matchedRules.length > 0;
      // TRIAGE_LEVELS is ordered most -> least severe, so the lowest index wins.
      const floorLevel = matchedFloors
        .map((f) => f.minLevel)
        .sort((a, b) => TRIAGE_LEVELS.indexOf(a) - TRIAGE_LEVELS.indexOf(b))[0];
      return {
        isEmergency,
        level: isEmergency ? 'EMERGENCY' : null,
        matchedRules,
        matchedFloors,
        minimumLevel: isEmergency ? 'EMERGENCY' : (floorLevel ?? null),
        unknownSymptoms,
        rulesVersion: ruleSet.version,
      };
    },
  };
}
