import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_NUMBER,
  getDisclaimer,
  getTriageLevel,
  redFlagEngine,
  symptomVocabulary,
  triageLevels,
} from './data';
import { LOCALES, TRIAGE_LEVELS } from './schemas';

describe('shared data files', () => {
  it('defines all four triage levels, ordered by severity', () => {
    const bySeverity = [...triageLevels.levels].sort((a, b) => b.severity - a.severity).map((l) => l.id);
    expect(bySeverity).toEqual([...TRIAGE_LEVELS]);
  });

  it('EMERGENCY title mentions the emergency number in every language', () => {
    const emergency = getTriageLevel('EMERGENCY');
    for (const locale of LOCALES) expect(emergency.title[locale]).toContain(EMERGENCY_NUMBER);
  });

  it('has a non-empty disclaimer in every language', () => {
    for (const locale of LOCALES) expect(getDisclaimer(locale).length).toBeGreaterThan(20);
  });

  it('covers every safety-required red-flag category', () => {
    const ids = redFlagEngine.rules.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'RF_CHEST_PAIN',
        'RF_BREATHING',
        'RF_UNCONSCIOUS',
        'RF_SEVERE_BLEEDING',
        'RF_STROKE_SIGNS',
        'RF_SEIZURE',
        'RF_HIGH_FEVER_INFANT',
        'RF_PREGNANCY_BLEEDING',
      ]),
    );
  });

  it('loads the symptom vocabulary', () => {
    expect(symptomVocabulary.symptoms.length).toBeGreaterThan(30);
  });
});
