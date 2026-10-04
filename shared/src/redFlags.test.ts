import { describe, expect, it } from 'vitest';
import symptomsJson from '../data/symptoms.json';
import { createRedFlagEngine } from './redFlags';
import { redFlagEngine } from './data';

const label = { en: 'x', ta: 'x', hi: 'x' };
const rules = (...rs: unknown[]) => ({ version: 'test', rules: rs });

describe('createRedFlagEngine validation (fail closed on bad rule files)', () => {
  it('rejects a rule that references an unknown symptom', () => {
    const bad = rules({ id: 'RF_X', label, when: { anySymptoms: ['not_a_symptom'] } });
    expect(() => createRedFlagEngine(bad, symptomsJson)).toThrow(/unknown symptom "not_a_symptom"/);
  });

  it('rejects unknown symptoms nested inside combinators', () => {
    const bad = rules({
      id: 'RF_X',
      label,
      when: { all: [{ ageMonthsLt: 3 }, { any: [{ anySymptoms: ['typo_fever'] }] }] },
    });
    expect(() => createRedFlagEngine(bad, symptomsJson)).toThrow(/typo_fever/);
  });

  it('rejects duplicate rule ids', () => {
    const r = { id: 'RF_X', label, when: { anySymptoms: ['chest_pain'] } };
    expect(() => createRedFlagEngine(rules(r, r), symptomsJson)).toThrow(/Duplicate/);
  });

  it('rejects a condition with an unknown key', () => {
    const bad = rules({ id: 'RF_X', label, when: { someSymptoms: ['chest_pain'] } });
    expect(() => createRedFlagEngine(bad, symptomsJson)).toThrow();
  });

  it('rejects a condition with more than one key', () => {
    const bad = rules({ id: 'RF_X', label, when: { anySymptoms: ['chest_pain'], pregnant: true } });
    expect(() => createRedFlagEngine(bad, symptomsJson)).toThrow();
  });

  it('rejects an empty symptom list', () => {
    const bad = rules({ id: 'RF_X', label, when: { anySymptoms: [] } });
    expect(() => createRedFlagEngine(bad, symptomsJson)).toThrow();
  });

  it('rejects a rule missing a translation', () => {
    const bad = rules({ id: 'RF_X', label: { en: 'x', hi: 'x' }, when: { anySymptoms: ['chest_pain'] } });
    expect(() => createRedFlagEngine(bad, symptomsJson)).toThrow();
  });
});

describe('redFlagEngine behaviour', () => {
  it('treats non-finite numbers as missing', () => {
    const r = redFlagEngine.evaluate({ symptoms: ['high_fever'], ageMonths: Number.NaN });
    expect(r.isEmergency).toBe(false);
  });

  it('returns matched rules in rule-file order', () => {
    const r = redFlagEngine.evaluate({ symptoms: ['seizure', 'chest_pain'] });
    expect(r.matchedRules.map((x) => x.id)).toEqual(['RF_CHEST_PAIN', 'RF_SEIZURE']);
  });

  it('reports the rules version', () => {
    expect(redFlagEngine.evaluate({ symptoms: [] }).rulesVersion).toBe(redFlagEngine.rulesVersion);
  });
});
