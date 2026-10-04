import { z } from 'zod';

// ───────────────────────────── i18n ─────────────────────────────

export const LOCALES = ['en', 'ta', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

/** Every user-facing string must exist in all supported locales. */
export const LocalizedTextSchema = z.strictObject({
  en: z.string().min(1),
  ta: z.string().min(1),
  hi: z.string().min(1),
});
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

// ───────────────────────────── Triage levels ─────────────────────────────

export const TRIAGE_LEVELS = ['EMERGENCY', 'SEE_DOCTOR_24H', 'SEE_DOCTOR_SOON', 'SELF_CARE'] as const;
export type TriageLevelId = (typeof TRIAGE_LEVELS)[number];

export const TriageLevelSchema = z.strictObject({
  id: z.enum(TRIAGE_LEVELS),
  severity: z.number().int().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  decidedBy: z.enum(['rule_engine', 'model']),
  title: LocalizedTextSchema,
  advice: LocalizedTextSchema,
});
export type TriageLevel = z.infer<typeof TriageLevelSchema>;

export const TriageLevelsFileSchema = z
  .strictObject({
    version: z.string(),
    emergencyNumber: z.string().regex(/^\d+$/),
    disclaimer: LocalizedTextSchema,
    levels: z.array(TriageLevelSchema),
  })
  .superRefine((file, ctx) => {
    const ids = file.levels.map((l) => l.id);
    for (const id of TRIAGE_LEVELS) {
      if (ids.filter((x) => x === id).length !== 1) {
        ctx.addIssue({ code: 'custom', message: `Triage level ${id} must be defined exactly once` });
      }
    }
    const emergency = file.levels.find((l) => l.id === 'EMERGENCY');
    if (emergency && emergency.decidedBy !== 'rule_engine') {
      ctx.addIssue({ code: 'custom', message: 'EMERGENCY must be decided by the rule engine only' });
    }
  });
export type TriageLevelsFile = z.infer<typeof TriageLevelsFileSchema>;

// ───────────────────────────── Symptom vocabulary ─────────────────────────────

export const SymptomSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/, 'symptom ids are lowercase snake_case'),
  category: z.string(),
  label: LocalizedTextSchema,
});
export type Symptom = z.infer<typeof SymptomSchema>;

export const SymptomVocabularySchema = z
  .strictObject({
    version: z.string(),
    notes: z.string().optional(),
    categories: z.array(z.string()).min(1),
    symptoms: z.array(SymptomSchema).min(1),
  })
  .superRefine((vocab, ctx) => {
    const seen = new Set<string>();
    for (const s of vocab.symptoms) {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', message: `Duplicate symptom id: ${s.id}` });
      seen.add(s.id);
      if (!vocab.categories.includes(s.category)) {
        ctx.addIssue({ code: 'custom', message: `Symptom ${s.id} has unknown category ${s.category}` });
      }
    }
  });
export type SymptomVocabulary = z.infer<typeof SymptomVocabularySchema>;

// ───────────────────────────── Red-flag rules ─────────────────────────────

/** A condition object has exactly one key. See shared/README.md for the grammar. */
export type Condition =
  | { anySymptoms: string[] }
  | { allSymptoms: string[] }
  | { ageMonthsLt: number }
  | { ageMonthsGte: number }
  | { pregnant: boolean }
  | { temperatureCGte: number }
  | { all: Condition[] }
  | { any: Condition[] };

const symptomList = z.array(z.string()).min(1);

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ anySymptoms: symptomList }),
    z.strictObject({ allSymptoms: symptomList }),
    z.strictObject({ ageMonthsLt: z.number().nonnegative() }),
    z.strictObject({ ageMonthsGte: z.number().nonnegative() }),
    z.strictObject({ pregnant: z.boolean() }),
    z.strictObject({ temperatureCGte: z.number() }),
    z.strictObject({ all: z.array(ConditionSchema).min(1) }),
    z.strictObject({ any: z.array(ConditionSchema).min(1) }),
  ]),
);

export const RedFlagRuleSchema = z.strictObject({
  id: z.string().regex(/^RF_[A-Z0-9_]+$/),
  label: LocalizedTextSchema,
  when: ConditionSchema,
});
export type RedFlagRule = z.infer<typeof RedFlagRuleSchema>;

export const RedFlagRuleSetSchema = z.strictObject({
  version: z.string(),
  notes: z.string().optional(),
  rules: z.array(RedFlagRuleSchema).min(1),
});
export type RedFlagRuleSet = z.infer<typeof RedFlagRuleSetSchema>;

// ───────────────────────────── Triage input ─────────────────────────────

/** Patient context accepted by the rule engine (and, later, the triage API). */
export const TriageContextSchema = z.object({
  symptoms: z.array(z.string().min(1).max(64)).max(50),
  ageMonths: z.number().int().min(0).max(1500).optional(),
  pregnant: z.boolean().optional(),
  temperatureC: z.number().min(30).max(45).optional(),
});
export type TriageContext = z.infer<typeof TriageContextSchema>;
