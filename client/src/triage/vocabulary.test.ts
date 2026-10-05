import { symptomVocabulary } from '@ruralcare/shared';
import { describe, expect, it } from 'vitest';
import {
  BODY_AREAS,
  DANGER_SYMPTOMS,
  searchSymptoms,
  shouldAskPregnancy,
  symptomsForAreas,
} from './vocabulary';

describe('pregnancy question (SAFETY.md §4: female, 12–50 years)', () => {
  it.each([
    ['female', 25 * 12, true],
    ['female', 12 * 12, true],
    ['female', 50 * 12 + 6, true],
    ['female', 11 * 12 + 11, false],
    ['female', 51 * 12, false],
    ['male', 25 * 12, false],
    ['other', 25 * 12, false],
    ['female', undefined, false],
  ] as const)('%s, %s months -> %s', (sex, months, expected) => {
    expect(shouldAskPregnancy(sex, months)).toBe(expected);
  });
});

describe('symptom search', () => {
  it('finds symptoms in Tamil and Hindi whatever the UI language', () => {
    expect(searchSymptoms('இருமல்', 'en').map((s) => s.id)).toContain('cough');
    expect(searchSymptoms('खांसी', 'ta').map((s) => s.id)).toContain('cough');
    expect(searchSymptoms('chest', 'hi').map((s) => s.id)).toContain('chest_pain');
  });

  it('ranks matches in the current language first', () => {
    expect(searchSymptoms('fever', 'en')[0]!.label.en.toLowerCase()).toContain('fever');
  });

  it('empty query returns nothing', () => {
    expect(searchSymptoms('  ', 'en')).toEqual([]);
  });
});

describe('body areas', () => {
  it('cover every symptom category', () => {
    const covered = new Set(BODY_AREAS.flatMap((a) => a.categories));
    for (const c of symptomVocabulary.categories) expect(covered.has(c), c).toBe(true);
  });

  it('no area chosen: every symptom is listed', () => {
    expect(symptomsForAreas([])).toHaveLength(symptomVocabulary.symptoms.length);
  });

  it('danger signs are always listed first', () => {
    const list = symptomsForAreas(['skin']);
    expect(list.slice(0, DANGER_SYMPTOMS.length)).toEqual(DANGER_SYMPTOMS);
    expect(list.map((s) => s.id)).toContain('itching');
    expect(DANGER_SYMPTOMS.map((s) => s.id)).toEqual(
      expect.arrayContaining(['chest_pain', 'seizure', 'face_drooping']),
    );
  });
});
