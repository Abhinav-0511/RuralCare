import { describe, expect, it } from 'vitest';
import { redFlagEngine } from './data';
import { ageBandFor, evaluateVitalAlerts, thresholdsFor, vitalsConfig } from './vitals';

const ADULT = 400;
const CHILD = 60;
const INFANT = 6;
const codes = (r: Parameters<typeof evaluateVitalAlerts>[0], ageMonths: number | null = ADULT) =>
  evaluateVitalAlerts(r, { ageMonths })
    .map((a) => a.code)
    .sort();

describe('evaluateVitalAlerts (adult)', () => {
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

describe('age-aware thresholds', () => {
  it('uses the red-flag age bands (child < 12 years; unknown age = adult)', () => {
    expect(ageBandFor(INFANT)).toBe('child');
    expect(ageBandFor(143)).toBe('child');
    expect(ageBandFor(144)).toBe('adult');
    expect(ageBandFor(undefined)).toBe('adult');
  });

  it("a baby's normal heart rate does not raise an adult alert", () => {
    expect(codes({ heartRate: 140 }, INFANT)).toEqual([]);
    expect(codes({ heartRate: 140 }, ADULT)).toEqual(['HR_HIGH']);
  });

  it('an adult-normal slow heart rate is critical for a child (and vice versa)', () => {
    expect(codes({ heartRate: 55 }, CHILD)).toEqual(['HR_CRITICAL_LOW_CHILD']);
    expect(codes({ heartRate: 55 }, ADULT)).toEqual([]);
    expect(codes({ heartRate: 185 }, CHILD)).toEqual(['HR_HIGH_CHILD']);
    expect(codes({ heartRate: 205 }, CHILD)).toEqual(['HR_CRITICAL_HIGH_CHILD']);
  });

  it('child blood pressure: low threshold is 70, high thresholds fall back to the adult values', () => {
    expect(codes({ systolicBp: 75 }, CHILD)).toEqual([]);
    expect(codes({ systolicBp: 65 }, CHILD)).toEqual(['BP_SYSTOLIC_CRITICAL_LOW_CHILD']);
    expect(codes({ systolicBp: 185 }, CHILD)).toEqual(['BP_SYSTOLIC_CRITICAL']);
  });

  it('unknown age uses the adult thresholds', () => {
    expect(codes({ heartRate: 140 }, null)).toEqual(['HR_HIGH']);
  });
});

describe('critical alerts and red-flag rules agree, for every age band', () => {
  const cases = [
    { band: 'adult', ageMonths: ADULT },
    { band: 'child', ageMonths: CHILD },
    { band: 'unknown', ageMonths: undefined },
  ];
  const ctxFor = (vital: string, value: number, ageMonths: number | undefined) => ({
    symptoms: [],
    ...(ageMonths === undefined ? {} : { ageMonths }),
    ...(vital === 'temperatureC' ? { temperatureC: value } : { vitals: { [vital]: value } }),
  });

  for (const { band, ageMonths } of cases) {
    const thresholds = thresholdsFor(ageMonths);
    it.each(thresholds.filter((t) => t.severity === 'critical').map((t) => [t.code, t] as const))(
      `${band}: critical %s triggers a red flag`,
      (_code, t) => {
        const value = t.op === 'lt' ? t.value - 1 : t.value;
        expect(redFlagEngine.evaluate(ctxFor(t.vital, value, ageMonths)).isEmergency).toBe(true);
      },
    );

    it(`${band}: warning thresholds alone never make triage an emergency`, () => {
      for (const t of thresholds.filter((x) => x.severity === 'warning')) {
        const value = t.op === 'lt' ? t.value - 0.5 : t.value;
        const v = t.vital === 'temperatureC' ? value : Math.round(value);
        expect(redFlagEngine.evaluate(ctxFor(t.vital, v, ageMonths)).isEmergency, t.code).toBe(false);
      }
    });
  }

  it('every age band referenced by a threshold is defined', () => {
    expect(Object.keys(vitalsConfig.ageBands).sort()).toEqual(['adult', 'child']);
  });
});
