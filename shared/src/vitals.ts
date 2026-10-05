import { z } from 'zod';
import vitalsJson from '../data/vitals.json';
import { LocalizedTextSchema, VITAL_KEYS } from './schemas';

export const ALERT_VITALS = [...VITAL_KEYS, 'temperatureC'] as const;
export type AlertVital = (typeof ALERT_VITALS)[number];
export const ALERT_SEVERITIES = ['warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const VitalThresholdSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]+$/),
  vital: z.enum(ALERT_VITALS),
  op: z.enum(['lt', 'gte']),
  value: z.number(),
  severity: z.enum(ALERT_SEVERITIES),
  label: LocalizedTextSchema,
});
export type VitalThreshold = z.infer<typeof VitalThresholdSchema>;

export const VitalsConfigSchema = z
  .strictObject({
    version: z.string(),
    notes: z.string().optional(),
    /** Vitals newer than this are attached to a triage. */
    recentWindowMinutes: z.number().int().positive(),
    thresholds: z.array(VitalThresholdSchema).min(1),
  })
  .superRefine((c, ctx) => {
    const codes = c.thresholds.map((t) => t.code);
    if (new Set(codes).size !== codes.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate threshold code' });
  });

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

/** Alerts for a reading: per vital and direction, only the most severe matching threshold. */
export function evaluateVitalAlerts(reading: VitalReading, config = vitalsConfig): VitalAlert[] {
  const best = new Map<string, VitalAlert>();
  for (const t of config.thresholds) {
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
