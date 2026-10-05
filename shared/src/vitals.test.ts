import { describe, expect, it } from 'vitest';
import { redFlagEngine } from './data';
import { evaluateVitalAlerts, vitalsConfig } from './vitals';

const codes = (r: Parameters<typeof evaluateVitalAlerts>[0]) =>
  evaluateVitalAlerts(r)
    .map((a) => a.code)
    .sort();

describe('evaluateVitalAlerts', () => {
  it('normal readings raise nothing', () => {
    expect(codes({ heartRate: 80, spo2: 97, temperatureC: 37, systolicBp: 120, diastolicBp: 80 })).toEqual(
      [],
    );
  });

  it('applies the requested thresholds', () => {
    expect(codes({ spo2: 91 })).toEqual(['SPO2_LOW']);
    expect(codes({ spo2: 92 })).toEqual([]);
    expect(codes({ temperatureC: 39.5 })).toEqual(['TEMP_HIGH']);
    expect(codes({ temperatureC: 39.4 })).toEqual([]);
    expect(codes({ heartRate: 125 })).toEqual(['HR_HIGH']);
    expect(codes({ heartRate: 45 })).toEqual(['HR_LOW']);
    expect(codes({ systolicBp: 165, diastolicBp: 95 })).toEqual(['BP_SYSTOLIC_HIGH']);
  });

  it('reports only the most severe threshold per vital and direction', () => {
    expect(codes({ spo2: 86 })).toEqual(['SPO2_CRITICAL']);
    expect(codes({ heartRate: 160 })).toEqual(['HR_CRITICAL_HIGH']);
    expect(codes({ heartRate: 35 })).toEqual(['HR_CRITICAL_LOW']);
    expect(codes({ systolicBp: 190, diastolicBp: 125 })).toEqual([
      'BP_DIASTOLIC_CRITICAL',
      'BP_SYSTOLIC_CRITICAL',
    ]);
  });

  it('includes the value, threshold and a translated label', () => {
    const [alert] = evaluateVitalAlerts({ spo2: 88 });
    expect(alert).toMatchObject({ severity: 'critical', vital: 'spo2', value: 88, threshold: 90 });
    expect(alert!.label.ta.length).toBeGreaterThan(3);
  });
});

describe('critical alerts and red-flag rules agree (adult)', () => {
  // Every critical threshold, just past its limit, must make triage EMERGENCY via the shared rules.
  it.each(vitalsConfig.thresholds.filter((t) => t.severity === 'critical').map((t) => [t.code, t] as const))(
    '%s',
    (_code, t) => {
      const value = t.op === 'lt' ? t.value - 1 : t.value;
      const ctx =
        t.vital === 'temperatureC'
          ? { symptoms: [], ageMonths: 400, temperatureC: value }
          : { symptoms: [], ageMonths: 400, vitals: { [t.vital]: value } };
      expect(redFlagEngine.evaluate(ctx).isEmergency).toBe(true);
    },
  );

  it('warning thresholds alone do not make triage an emergency', () => {
    for (const t of vitalsConfig.thresholds.filter((x) => x.severity === 'warning')) {
      const value = t.op === 'lt' ? t.value - 0.5 : t.value;
      const ctx =
        t.vital === 'temperatureC'
          ? { symptoms: [], ageMonths: 400, temperatureC: value }
          : { symptoms: [], ageMonths: 400, vitals: { [t.vital]: Math.round(value) } };
      expect(redFlagEngine.evaluate(ctx).isEmergency, t.code).toBe(false);
    }
  });
});
