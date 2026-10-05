import { z } from 'zod';
import vitalsJson from '../data/vitals.json';
import { LocalizedTextSchema, VITAL_KEYS } from './schemas';

export const ALERT_VITALS = [...VITAL_KEYS, 'temperatureC'] as const;
export type AlertVital = (typeof ALERT_VITALS)[number];
export const ALERT_SEVERITIES = ['warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

const AgeBandSchema = z
  .strictObject({ ageMonthsLt: z.number().optional(), ageMonthsGte: z.number().optional() })
  .refine((b) => b.ageMonthsLt !== undefined || b.ageMonthsGte !== undefined, 'Empty age band');

export const VitalThresholdSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]+$/),
  vital: z.enum(ALERT_VITALS),
  op: z.enum(['lt', 'gte']),
  value: z.number(),
  severity: z.enum(ALERT_SEVERITIES),
  /** Only applies to patients in this band. Without it the threshold applies to every age. */
  ageBand: z.string().optional(),
  label: LocalizedTextSchema,
});
export type VitalThreshold = z.infer<typeof VitalThresholdSchema>;

export const VitalsConfigSchema = z
  .strictObject({
    version: z.string(),
    notes: z.string().optional(),
    /** Vitals newer than this are attached to a triage. */
    recentWindowMinutes: z.number().int().positive(),
    ageBands: z.record(z.string(), AgeBandSchema),
    /** Band used when the age is unknown (adult, like the red-flag rules). */
    unknownAgeBand: z.string(),
    thresholds: z.array(VitalThresholdSchema).min(1),
  })
  .superRefine((c, ctx) => {
    const codes = c.thresholds.map((t) => t.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate threshold code' });
    }
    for (const band of [c.unknownAgeBand, ...c.thresholds.flatMap((t) => (t.ageBand ? [t.ageBand] : []))]) {
      if (!c.ageBands[band]) ctx.addIssue({ code: 'custom', message: `Unknown age band ${band}` });
    }
  });
export type VitalsConfig = z.infer<typeof VitalsConfigSchema>;

export const vitalsConfig = VitalsConfigSchema.parse(vitalsJson);

/** One device reading (any subset of vitals). */
export type VitalReading = Partial<Record<AlertVital, number>>;

export interface VitalAlert {
  code: string;
  severity: AlertSeverity;
  vital: AlertVital;
  value: number;
  threshold: number;
  label: VitalThreshold['label'];
}

const breaches = (t: VitalThreshold, v: number) => (t.op === 'lt' ? v < t.value : v >= t.value);
const rank = (s: AlertSeverity) => ALERT_SEVERITIES.indexOf(s);

/** The age band a patient falls in (unknown age -> `unknownAgeBand`). */
export function ageBandFor(
  ageMonths: number | null | undefined,
  config: VitalsConfig = vitalsConfig,
): string {
  if (ageMonths === null || ageMonths === undefined || !Number.isFinite(ageMonths))
    return config.unknownAgeBand;
  const match = Object.entries(config.ageBands).find(
    ([, b]) =>
      (b.ageMonthsLt === undefined || ageMonths < b.ageMonthsLt) &&
      (b.ageMonthsGte === undefined || ageMonths >= b.ageMonthsGte),
  );
  return match ? match[0] : config.unknownAgeBand;
}

/** Thresholds that apply to a patient of this age. */
export function thresholdsFor(
  ageMonths: number | null | undefined,
  config: VitalsConfig = vitalsConfig,
): VitalThreshold[] {
  const band = ageBandFor(ageMonths, config);
  return config.thresholds.filter((t) => !t.ageBand || t.ageBand === band);
}

/**
 * Alerts for a reading: per vital and direction, only the most severe matching threshold.
 * Age-aware: a baby's normal heart rate of 140 does not raise the adult "fast heartbeat" alert.
 */
export function evaluateVitalAlerts(
  reading: VitalReading,
  options: { ageMonths?: number | null } = {},
  config: VitalsConfig = vitalsConfig,
): VitalAlert[] {
  const best = new Map<string, VitalAlert>();
  for (const t of thresholdsFor(options.ageMonths, config)) {
    const value = reading[t.vital];
    if (value === undefined || !Number.isFinite(value) || !breaches(t, value)) continue;
    const key = `${t.vital}:${t.op}`;
    const current = best.get(key);
    if (!current || rank(t.severity) > rank(current.severity)) {
      best.set(key, {
        code: t.code,
        severity: t.severity,
        vital: t.vital,
        value,
        threshold: t.value,
        label: t.label,
      });
    }
  }
  return [...best.values()];
}
