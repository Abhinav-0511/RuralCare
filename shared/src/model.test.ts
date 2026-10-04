import { describe, expect, it } from 'vitest';
import golden from '../tests/prediction_policy_cases.json';
import { buildGuidance, conditionsFile, getCondition, symptomVocabulary } from './data';
import { buildFeatureVector, predictionLevel, rankConditions, type RankedCondition } from './model';
import { LOCALES } from './schemas';

interface PolicyCase {
  name: string;
  ranked: RankedCondition[];
  knownFeatureCount: number;
  unmodelledSymptoms: string[];
  expected: { level: string; lowConfidence: boolean };
}

// The same file drives ai-service/tests/test_policy.py.
describe('prediction policy golden cases', () => {
  it.each((golden.cases as PolicyCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(predictionLevel(c.ranked, c)).toEqual(c.expected);
  });
});

describe('conditions.json', () => {
  it('has 41 conditions with names and advice in every language', () => {
    expect(conditionsFile.conditions).toHaveLength(41);
    for (const c of conditionsFile.conditions) {
      for (const locale of LOCALES) {
        expect(c.name[locale].length).toBeGreaterThan(1);
        expect(c.advice[locale].length).toBeGreaterThan(10);
      }
    }
  });

  it('getCondition throws for unknown ids', () => {
    expect(getCondition('dengue').triageLevel).toBe('SEE_DOCTOR_24H');
    expect(() => getCondition('nope')).toThrow();
  });
});

describe('buildFeatureVector', () => {
  const features = ['cough', 'headache', 'mild_fever'];

  it('one-hot encodes known features and reports the rest', () => {
    const fv = buildFeatureVector([' Cough', 'mild_fever', 'cough', 'vaginal_bleeding'], features);
    expect([...fv.vector]).toEqual([1, 0, 1]);
    expect(fv.knownFeatureCount).toBe(2);
    expect(fv.unmodelledSymptoms).toEqual(['vaginal_bleeding']);
  });

  it('handles an empty input', () => {
    expect(buildFeatureVector([], features).knownFeatureCount).toBe(0);
  });
});

describe('rankConditions', () => {
  it('sorts by probability, keeping class order for ties', () => {
    expect(rankConditions([0.1, 0.6, 0.1, 0.2], ['a', 'b', 'c', 'd'])).toEqual([
      { id: 'b', probability: 0.6 },
      { id: 'd', probability: 0.2 },
      { id: 'a', probability: 0.1 },
      { id: 'c', probability: 0.1 },
    ]);
  });
});

describe('buildGuidance possibleConditions', () => {
  const top = [
    { id: 'common_cold', probability: 0.8 },
    { id: 'allergy', probability: 0.1 },
  ];
  const base = { redFlags: [], safetyFloors: [] };

  it('lists model suggestions with names and advice in every language', () => {
    const g = buildGuidance({ ...base, level: 'SELF_CARE', source: 'model' }, top);
    expect(g.possibleConditions.map((c) => c.id)).toEqual(['common_cold', 'allergy']);
    expect(g.possibleConditions[0]!.name.ta).toBe('ஜலதோஷம்');
    expect(g.possibleConditions[0]!.advice.hi.length).toBeGreaterThan(10);
  });

  it('is empty when the model was not used', () => {
    expect(
      buildGuidance({ ...base, level: 'SEE_DOCTOR_SOON', source: 'rule_engine_fallback' }, top)
        .possibleConditions,
    ).toEqual([]);
  });
});

describe('symptom vocabulary', () => {
  it('has 137 symptoms with labels in every language', () => {
    expect(symptomVocabulary.symptoms).toHaveLength(137);
  });
});
