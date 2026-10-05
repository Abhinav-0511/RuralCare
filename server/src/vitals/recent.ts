import {
  type AlertVital,
  evaluateVitalAlerts,
  type TriageContext,
  type Vitals,
  vitalsConfig,
} from '@ruralcare/shared';
import type { VitalsStore } from './store';

export type VitalsSource = 'manual' | 'device';

export interface WithVitals<T> {
  input: T;
  vitalsSource: VitalsSource | null;
  vitalsMeasuredAt?: Date;
}

const severityRank = (vital: AlertVital, value: number) =>
  Math.max(0, ...evaluateVitalAlerts({ [vital]: value }).map((a) => (a.severity === 'critical' ? 2 : 1)));

/**
 * The value triage should see for one vital: the MOST ABNORMAL reading in the window (by alert
 * severity), otherwise the latest. A brief critical reading followed by normal ones must still reach
 * the red-flag rules (safety over accuracy: a sensor glitch can over-triage, never under-triage).
 */
export function mostAbnormal(vital: AlertVital, v: { last: number; min: number; max: number }): number {
  // Candidates in preference order, so ties keep the latest value.
  return [v.last, v.min, v.max].reduce((best, c) =>
    severityRank(vital, c) > severityRank(vital, best) ? c : best,
  );
}

/**
 * If the triage input has no vitals, attach the patient's device readings from the last
 * `recentWindowMinutes` before `at`. Vitals typed in by the user win. A TimescaleDB failure never
 * blocks triage: it continues without device vitals.
 */
export async function attachRecentVitals<T extends TriageContext>(
  input: T,
  patientId: string,
  at: Date,
  store: VitalsStore | null | undefined,
): Promise<WithVitals<T>> {
  if (input.vitals && Object.keys(input.vitals).length > 0) return { input, vitalsSource: 'manual' };
  if (!store) return { input, vitalsSource: null };

  try {
    const from = new Date(at.getTime() - vitalsConfig.recentWindowMinutes * 60_000);
    const recent = await store.extremes(patientId, from, at);
    if (!recent) return { input, vitalsSource: null };

    const vitals: Vitals = {};
    for (const key of ['heartRate', 'spo2', 'systolicBp', 'diastolicBp'] as const) {
      const v = recent.values[key];
      if (v) vitals[key] = mostAbnormal(key, v);
    }
    const deviceTemp = recent.values.temperatureC;
    const temperatureC =
      input.temperatureC ?? (deviceTemp ? mostAbnormal('temperatureC', deviceTemp) : undefined);
    return {
      input: { ...input, vitals, ...(temperatureC !== undefined ? { temperatureC } : {}) },
      vitalsSource: 'device',
      vitalsMeasuredAt: recent.measuredAt,
    };
  } catch (err) {
    console.error('Could not read recent vitals; continuing without them', err);
    return { input, vitalsSource: null };
  }
}
