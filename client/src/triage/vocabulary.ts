// Body areas, symptom icons and search for the triage wizard (low-literacy friendly).
import { type Locale, symptomVocabulary } from '@ruralcare/shared';
import type { StringKey } from '../i18n/strings';

export interface BodyArea {
  id: string;
  label: StringKey;
  icon: string;
  categories: string[];
}

export const BODY_AREAS: BodyArea[] = [
  { id: 'danger', label: 'area.danger', icon: '🚨', categories: ['emergency'] },
  { id: 'head', label: 'area.head', icon: '🧠', categories: ['neuro', 'eyes', 'mood'] },
  { id: 'chest', label: 'area.chest', icon: '🫁', categories: ['respiratory'] },
  { id: 'stomach', label: 'area.stomach', icon: '🍽️', categories: ['digestive'] },
  { id: 'skin', label: 'area.skin', icon: '🖐️', categories: ['skin'] },
  { id: 'urine', label: 'area.urine', icon: '🚻', categories: ['urinary'] },
  { id: 'body', label: 'area.body', icon: '🌡️', categories: ['general', 'pain'] },
  { id: 'women', label: 'area.women', icon: '🤰', categories: ['womens_health'] },
  { id: 'history', label: 'area.history', icon: '📋', categories: ['history'] },
];

const CATEGORY_ICON: Record<string, string> = {
  emergency: '🚨',
  general: '🌡️',
  respiratory: '🫁',
  digestive: '🍽️',
  pain: '🤕',
  skin: '🖐️',
  urinary: '🚻',
  neuro: '🧠',
  eyes: '👁️',
  mood: '😟',
  womens_health: '🤰',
  history: '📋',
};

const SYMPTOM_ICON: Record<string, string> = {
  chest_pain: '💔',
  breathlessness: '😮‍💨',
  unconscious: '😵',
  coma: '😵',
  severe_bleeding: '🩸',
  vomiting_blood: '🩸',
  stomach_bleeding: '🩸',
  blood_in_sputum: '🩸',
  vaginal_bleeding: '🩸',
  seizure: '⚡',
  face_drooping: '😶',
  slurred_speech: '🗣️',
  weakness_of_one_body_side: '🦾',
  altered_sensorium: '😵‍💫',
  high_fever: '🔥',
  mild_fever: '🌡️',
  chills: '🥶',
  shivering: '🥶',
  cough: '😷',
  runny_nose: '🤧',
  continuous_sneezing: '🤧',
  congestion: '🤧',
  headache: '🤕',
  dizziness: '😵‍💫',
  vomiting: '🤮',
  nausea: '🤢',
  diarrhoea: '🚽',
  constipation: '🚽',
  abdominal_pain: '🤰',
  stomach_pain: '🤰',
  back_pain: '🧍',
  joint_pain: '🦴',
  knee_pain: '🦵',
  muscle_pain: '💪',
  skin_rash: '🔴',
  itching: '🖐️',
  fatigue: '😴',
  lethargy: '😴',
  sweating: '💦',
  dehydration: '💧',
  yellowish_skin: '🟡',
  yellowing_of_eyes: '🟡',
  dark_urine: '🟤',
  burning_micturition: '🔥',
  weight_loss: '⚖️',
  loss_of_appetite: '🍽️',
  redness_of_eyes: '👁️',
  blurred_and_distorted_vision: '👓',
};

export const iconFor = (id: string, category: string) => SYMPTOM_ICON[id] ?? CATEGORY_ICON[category] ?? '•';

export const symptomsById = new Map(symptomVocabulary.symptoms.map((s) => [s.id, s]));

export const DANGER_SYMPTOMS = symptomVocabulary.symptoms.filter(
  (s) =>
    s.category === 'emergency' ||
    [
      'face_drooping',
      'slurred_speech',
      'weakness_of_one_body_side',
      'seizure',
      'altered_sensorium',
      'blood_in_sputum',
    ].includes(s.id),
);

/** Symptoms for the chosen areas, or all of them if none was chosen (danger signs always first). */
export function symptomsForAreas(areaIds: string[]) {
  const chosen = areaIds.length ? BODY_AREAS.filter((a) => areaIds.includes(a.id)) : BODY_AREAS;
  const categories = new Set(chosen.flatMap((a) => a.categories));
  const dangerIds = new Set(DANGER_SYMPTOMS.map((s) => s.id));
  return [
    ...DANGER_SYMPTOMS,
    ...symptomVocabulary.symptoms.filter((s) => categories.has(s.category) && !dangerIds.has(s.id)),
  ];
}

const normalize = (s: string) => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

/** Search across all three languages (and the id), whatever the UI language is. */
export function searchSymptoms(query: string, locale: Locale) {
  const q = normalize(query);
  if (!q) return [];
  const hits = symptomVocabulary.symptoms.filter((s) =>
    [s.label.en, s.label.ta, s.label.hi, s.id.replaceAll('_', ' ')].some((l) => normalize(l).includes(q)),
  );
  // Matches in the current language first.
  return hits.sort(
    (a, b) =>
      Number(!normalize(a.label[locale]).includes(q)) - Number(!normalize(b.label[locale]).includes(q)),
  );
}

/** Pregnancy question rule from docs/SAFETY.md §4: female and 12–50 years. */
export const shouldAskPregnancy = (sex: string | undefined, ageMonths: number | undefined) =>
  sex === 'female' && ageMonths !== undefined && ageMonths >= 12 * 12 && ageMonths <= 50 * 12 + 11;

export const DURATIONS: { key: StringKey; days: number }[] = [
  { key: 'duration.today', days: 0 },
  { key: 'duration.1to2', days: 2 },
  { key: 'duration.3to6', days: 5 },
  { key: 'duration.1to2w', days: 10 },
  { key: 'duration.2wplus', days: 14 },
  { key: 'duration.1mplus', days: 30 },
];
