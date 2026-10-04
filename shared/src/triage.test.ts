import { describe, expect, it } from 'vitest';
import { buildGuidance, MODEL_UNAVAILABLE_FALLBACK_LEVEL, redFlagEngine, triageLevels } from './data';
import { decideTriage, type ModelOutcome, mostSevere, severityOf } from './triage';

const ok = (level: 'SEE_DOCTOR_24H' | 'SEE_DOCTOR_SOON' | 'SELF_CARE'): ModelOutcome => ({
  status: 'ok',
  prediction: { level, confidence: 0.9, modelVersion: 'test', topConditions: [] },
});
const down: ModelOutcome = { status: 'unavailable', reason: 'ECONNREFUSED' };
const fallback = MODEL_UNAVAILABLE_FALLBACK_LEVEL;

describe('severity helpers', () => {
  it('orders levels', () => {
    expect(severityOf('EMERGENCY')).toBeGreaterThan(severityOf('SEE_DOCTOR_24H'));
    expect(severityOf('SEE_DOCTOR_SOON')).toBeGreaterThan(severityOf('SELF_CARE'));
    expect(mostSevere('SELF_CARE', 'SEE_DOCTOR_24H')).toBe('SEE_DOCTOR_24H');
    expect(mostSevere('SEE_DOCTOR_24H', 'SELF_CARE')).toBe('SEE_DOCTOR_24H');
    expect(mostSevere('SELF_CARE', null)).toBe('SELF_CARE');
  });
});

describe('decideTriage', () => {
  it('red flag => EMERGENCY from the rule engine; model output is ignored', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['chest_pain'], ageMonths: 400 });
    const d = decideTriage(rf, ok('SELF_CARE'), fallback);
    expect(d).toMatchObject({ level: 'EMERGENCY', source: 'rule_engine', model: { status: 'not_called' } });
    expect(d.redFlags).toEqual(['RF_CHEST_PAIN']);
  });

  it('uses the model level when there is no red flag or floor', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['cough'], ageMonths: 400 });
    expect(decideTriage(rf, ok('SELF_CARE'), fallback)).toMatchObject({
      level: 'SELF_CARE',
      source: 'model',
    });
  });

  it('safety floor raises a SELF_CARE model result (fever, age unknown) to SEE_DOCTOR_24H', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['mild_fever'] });
    const d = decideTriage(rf, ok('SELF_CARE'), fallback);
    expect(d.level).toBe('SEE_DOCTOR_24H');
    expect(d.safetyFloors).toEqual(['FLOOR_FEVER_AGE_UNKNOWN']);
  });

  it('floor does not lower a more severe model result', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['mild_fever'] });
    expect(decideTriage(rf, ok('SEE_DOCTOR_24H'), fallback).level).toBe('SEE_DOCTOR_24H');
  });

  it('model unavailable => rules-only fallback, never SELF_CARE', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['cough'], ageMonths: 400 });
    const d = decideTriage(rf, down, fallback);
    expect(d).toMatchObject({
      level: 'SEE_DOCTOR_SOON',
      source: 'rule_engine_fallback',
      model: { status: 'unavailable', reason: 'ECONNREFUSED' },
    });
    expect(buildGuidance(d).notice).toEqual(triageLevels.modelUnavailable.notice);
  });

  it('model unavailable + fever with unknown age => SEE_DOCTOR_24H', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['high_fever'] });
    expect(decideTriage(rf, down, fallback).level).toBe('SEE_DOCTOR_24H');
  });

  it('model not called (null) is treated as unavailable', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['cough'], ageMonths: 400 });
    expect(decideTriage(rf, null, fallback).source).toBe('rule_engine_fallback');
  });
});

describe('buildGuidance', () => {
  it('always includes the disclaimer, plus reasons for red flags', () => {
    const rf = redFlagEngine.evaluate({ symptoms: ['seizure'], ageMonths: 100 });
    const g = buildGuidance(decideTriage(rf, null, fallback));
    expect(g.disclaimer).toEqual(triageLevels.disclaimer);
    expect(g.title.en).toContain('108');
    expect(g.reasons.map((r) => r.en)).toEqual(['Seizure / fits']);
    expect(g.notice).toBeUndefined();
  });
});
