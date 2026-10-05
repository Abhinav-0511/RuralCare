import {
  type AlertVital,
  evaluateVitalAlerts,
  type TriageContext,
  type Vitals,
  vitalsConfig,
} from '@ruralcare/shared';
import type { VitalsStore } from './store';

export type VitalsSource = 'manual' | 'device' | 'combined';

export interface WithVitals<T> {
  input: T;
  vitalsSource: VitalsSource | null;
  vitalsMeasuredAt?: Date;
}

const VITALS = ['heartRate', 'spo2', 'systolicBp', 'diastolicBp'] as const;

const severityRank = (vital: AlertVital, value: number, ageMonths: number | undefined) =>
  Math.max(
    0,
    ...evaluateVitalAlerts({ [vital]: value }, { ageMonths: ageMonths ?? null }).map((a) =>
      a.severity === 'critical' ? 2 : 1,
    ),
  );

/**
 * The value triage should see for one vital: the MOST ABNORMAL candidate (by the patient's
 * age-aware alert severity); ties keep the earlier candidate. Safety over accuracy: a sensor glitch
 * or a typo can over-triage, never under-triage.
 */
export function mostAbnormal(vital: AlertVital, candidates: number[], ageMonths?: number): number {
  if (!candidates.length) throw new Error('mostAbnormal needs at least one value');
  return candidates.reduce((best, c) =>
    severityRank(vital, c, ageMonths) > severityRank(vital, best, ageMonths) ? c : best,
  );
}

/**
 * Combines vitals typed in by the user with the patient's device readings from the last
 * `recentWindowMinutes` before `at`, taking the WORSE value of each vital (typed-in value first,
 * then the device's latest, lowest and highest reading). A TimescaleDB failure never blocks triage:
 * it continues with the typed-in values only.
 */
export async function attachRecentVitals<T extends TriageContext>(
  input: T,
  patientId: string,
  at: Date,
  store: VitalsStore | null | undefined,
): Promise<WithVitals<T>> {
  const typed: Partial<Record<AlertVital, number>> = { ...(input.vitals ?? {}) };
  if (input.temperatureC !== undefined) typed.temperatureC = input.temperatureC;
  const hasTyped = Object.keys(typed).length > 0;

  let device: Awaited<ReturnType<VitalsStore['extremes']>> = null;
  if (store) {
    try {
      const from = new Date(at.getTime() - vitalsConfig.recentWindowMinutes * 60_000);
      device = await store.extremes(patientId, from, at);
    } catch (err) {
      console.error('Could not read recent vitals; continuing with typed-in values only', err);
    }
  }
  if (!device) return { input, vitalsSource: hasTyped ? 'manual' : null };

  const pick = (vital: AlertVital): number | undefined => {
    const d = device.values[vital];
    const candidates = [
      ...(typed[vital] !== undefined ? [typed[vital]] : []),
      ...(d ? [d.last, d.min, d.max] : []),
    ];
    return candidates.length ? mostAbnormal(vital, candidates, input.ageMonths) : undefined;
  };

  const vitals: Vitals = {};
  for (const key of VITALS) {
    const v = pick(key);
    if (v !== undefined) vitals[key] = v;
  }
  const temperatureC = pick('temperatureC');
  return {
    input: { ...input, vitals, ...(temperatureC !== undefined ? { temperatureC } : {}) },
    vitalsSource: hasTyped ? 'combined' : 'device',
    vitalsMeasuredAt: device.measuredAt,
  };
}
