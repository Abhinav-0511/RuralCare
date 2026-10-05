import { SEXES, type Severity, type Sex, TriageInputSchema, type Vitals } from '@ruralcare/shared';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, ErrorBox } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/strings';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { usePatients } from '../lib/hooks';
import { useModel } from '../model/ModelProvider';
import { submitTriage } from '../triage/submit';
import {
  BODY_AREAS,
  DURATIONS,
  iconFor,
  searchSymptoms,
  shouldAskPregnancy,
  symptomsById,
  symptomsForAreas,
} from '../triage/vocabulary';

type Step = 'patient' | 'area' | 'symptoms' | 'duration' | 'severity' | 'person' | 'vitals' | 'review';
type VitalField = keyof Vitals | 'temperatureC';

const VITAL_FIELDS: { key: VitalField; min: number; max: number; step: number }[] = [
  { key: 'temperatureC', min: 30, max: 45, step: 0.1 },
  { key: 'spo2', min: 50, max: 100, step: 1 },
  { key: 'heartRate', min: 20, max: 250, step: 1 },
  { key: 'systolicBp', min: 50, max: 260, step: 1 },
  { key: 'diastolicBp', min: 30, max: 160, step: 1 },
];

interface Draft {
  patientId?: string;
  patientName?: string;
  areas: string[];
  symptoms: string[];
  durationDays?: number;
  severity?: Severity;
  ageYears: string;
  ageMonths: string;
  sex?: Sex;
  pregnancy?: 'yes' | 'no' | 'unsure';
  vitals: Partial<Record<VitalField, string>>;
}

const toAgeMonths = (d: Draft): number | undefined => {
  if (d.ageYears === '' && d.ageMonths === '') return undefined;
  const months = Number(d.ageYears || 0) * 12 + Number(d.ageMonths || 0);
  return Number.isFinite(months) && months >= 0 ? Math.round(months) : undefined;
};

const vitalError = (field: (typeof VITAL_FIELDS)[number], raw: string | undefined) => {
  if (raw === undefined || raw === '') return false;
  const v = Number(raw);
  return !Number.isFinite(v) || v < field.min || v > field.max;
};

function Choice({
  selected,
  onClick,
  children,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left text-base ${
        selected ? 'border-teal-700 bg-teal-50 font-semibold' : 'border-slate-200 bg-white'
      }`}
    >
      {children}
    </button>
  );
}

/** Web Speech API: fills the search box. Hidden when the browser doesn't support it. */
function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const { t, locale } = useI18n();
  const [listening, setListening] = useState(false);
  const Recognition =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .webkitSpeechRecognition;
  if (!Recognition) return null;
  const start = () => {
    const rec = new Recognition();
    rec.lang = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN' }[locale];
    rec.interimResults = false;
    rec.onresult = (e) => onText(e.results[0]?.[0]?.transcript ?? '');
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };
  return (
    <Button variant="secondary" onClick={start} aria-label={t('wizard.symptoms.voice')}>
      🎤 {listening ? t('wizard.symptoms.listening') : t('wizard.symptoms.voice')}
    </Button>
  );
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
}

export default function TriageWizard() {
  const { t, loc, locale } = useI18n();
  const { user } = useAuth();
  const online = useOnline();
  const { predictor } = useModel();
  const patients = usePatients();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isStaff = user?.role !== 'patient';

  const steps: Step[] = useMemo(
    () => [
      ...(isStaff ? (['patient'] as Step[]) : []),
      'area',
      'symptoms',
      'duration',
      'severity',
      'person',
      'vitals',
      'review',
    ],
    [isStaff],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex]!;
  const [draft, setDraft] = useState<Draft>({
    areas: [],
    symptoms: [],
    ageYears: '',
    ageMonths: '',
    vitals: {},
  });
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const choosePatient = (id: string) => {
    const p = patients.find((x) => x.id === id);
    if (!p) return;
    update({
      patientId: p.id,
      patientName: p.name,
      sex: p.sex,
      ageYears: String(Math.floor(p.ageMonths / 12)),
      ageMonths: String(p.ageMonths % 12),
    });
  };

  // Patient: their own record. Staff: ?patient=<id> from a dashboard. Applied once, when the
  // (cached) patient list contains it — React's "adjust state during render" pattern.
  const prefillId = isStaff ? params.get('patient') : user?.patientId;
  const [prefilledId, setPrefilledId] = useState<string | null>(null);
  if (prefillId && prefilledId !== prefillId && patients.some((p) => p.id === prefillId)) {
    setPrefilledId(prefillId);
    choosePatient(prefillId);
    if (isStaff) setStepIndex(1);
  }

  const ageMonths = toAgeMonths(draft);
  const askPregnancy = shouldAskPregnancy(draft.sex, ageMonths);

  const validate = (): string | null => {
    if (step === 'patient' && !draft.patientId) return t('wizard.patient.search');
    if (step === 'symptoms' && draft.symptoms.length === 0) return t('wizard.symptoms.required');
    if (step === 'person' && ageMonths === undefined) return t('wizard.ageRequired');
    if (step === 'person' && !draft.sex) return t('wizard.sex');
    if (step === 'vitals' && VITAL_FIELDS.some((f) => vitalError(f, draft.vitals[f.key])))
      return t('vitals.invalid');
    return null;
  };

  const next = () => {
    const problem = validate();
    setError(problem);
    if (!problem) setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const submit = async () => {
    const patientId = draft.patientId ?? user?.patientId;
    if (!patientId) return setError(t('wizard.patient.search'));
    const vitals: Vitals = {};
    for (const k of ['heartRate', 'spo2', 'systolicBp', 'diastolicBp'] as const) {
      if (draft.vitals[k]) vitals[k] = Math.round(Number(draft.vitals[k]));
    }
    const parsed = TriageInputSchema.safeParse({
      symptoms: draft.symptoms,
      ageMonths,
      sex: draft.sex,
      ...(askPregnancy && draft.pregnancy && draft.pregnancy !== 'unsure'
        ? { pregnant: draft.pregnancy === 'yes' }
        : {}),
      ...(draft.vitals.temperatureC ? { temperatureC: Number(draft.vitals.temperatureC) } : {}),
      ...(Object.keys(vitals).length ? { vitals } : {}),
      ...(draft.durationDays !== undefined ? { durationDays: draft.durationDays } : {}),
      ...(draft.severity ? { severity: draft.severity } : {}),
    });
    if (!parsed.success) return setError(t('common.error'));
    setBusy(true);
    try {
      const session = await submitTriage({
        patientId,
        ...(draft.patientName ? { patientName: draft.patientName } : {}),
        input: parsed.data,
        online,
        predictor,
      });
      navigate(`/result/${session.clientId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSymptom = (id: string) =>
    update({
      symptoms: draft.symptoms.includes(id)
        ? draft.symptoms.filter((s) => s !== id)
        : [...draft.symptoms, id],
    });
  const listed = query ? searchSymptoms(query, locale) : symptomsForAreas(draft.areas);
  const titleKey: Record<Step, StringKey> = {
    patient: 'wizard.patient.title',
    area: 'wizard.area.title',
    symptoms: 'wizard.symptoms.title',
    duration: 'wizard.duration.title',
    severity: 'wizard.severity.title',
    person: 'wizard.person.title',
    vitals: 'wizard.vitals.title',
    review: 'wizard.review.title',
  };

  return (
    <div className="space-y-4" data-testid={`wizard-step-${step}`}>
      <div>
        <p className="text-sm text-slate-600">
          {t('wizard.step', { n: stepIndex + 1, total: steps.length })}
        </p>
        <div className="mt-1 h-2 rounded bg-slate-200" aria-hidden>
          <div
            className="h-2 rounded bg-teal-600"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
        <h1 className="mt-3 text-2xl font-bold">{t(titleKey[step])}</h1>
      </div>

      {step === 'patient' && (
        <div className="space-y-2">
          <input
            type="search"
            placeholder={t('wizard.patient.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg"
          />
          {!online && <p className="text-sm text-slate-600">{t('wizard.patient.cached')}</p>}
          {patients
            .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
            .map((p) => (
              <Choice
                key={p.id}
                selected={draft.patientId === p.id}
                onClick={() => choosePatient(p.id)}
                testId="patient-option"
              >
                <span className="text-2xl" aria-hidden>
                  {p.sex === 'female' ? '👩' : p.sex === 'male' ? '👨' : '🧑'}
                </span>
                <span>
                  {p.name}
                  <span className="block text-sm font-normal text-slate-600">
                    {t('patient.years', { n: Math.floor(p.ageMonths / 12) })}
                  </span>
                </span>
              </Choice>
            ))}
          {patients.length === 0 && <p>{t('wizard.patient.none')}</p>}
        </div>
      )}

      {step === 'area' && (
        <div className="space-y-2">
          <p className="text-slate-600">{t('wizard.area.hint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {BODY_AREAS.map((a) => (
              <Choice
                key={a.id}
                testId={`area-${a.id}`}
                selected={draft.areas.includes(a.id)}
                onClick={() =>
                  update({
                    areas: draft.areas.includes(a.id)
                      ? draft.areas.filter((x) => x !== a.id)
                      : [...draft.areas, a.id],
                  })
                }
              >
                <span className="text-3xl" aria-hidden>
                  {a.icon}
                </span>
                <span>{t(a.label)}</span>
              </Choice>
            ))}
          </div>
        </div>
      )}

      {step === 'symptoms' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="search"
              data-testid="symptom-search"
              placeholder={t('wizard.symptoms.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-lg"
            />
            <VoiceButton onText={setQuery} />
          </div>
          <p className="text-sm text-slate-700">
            {t('wizard.symptoms.selected', { n: draft.symptoms.length })}
          </p>
          {!query && (
            <p className="rounded-xl bg-red-50 p-2 text-sm text-red-900">{t('wizard.symptoms.danger')}</p>
          )}
          {query && listed.length === 0 && <p>{t('wizard.symptoms.noMatch')}</p>}
          <div className="space-y-2">
            {listed.map((s) => (
              <Choice
                key={s.id}
                testId={`symptom-${s.id}`}
                selected={draft.symptoms.includes(s.id)}
                onClick={() => toggleSymptom(s.id)}
              >
                <span className="text-2xl" aria-hidden>
                  {iconFor(s.id, s.category)}
                </span>
                <span>{loc(s.label)}</span>
              </Choice>
            ))}
          </div>
        </div>
      )}

      {step === 'duration' && (
        <div className="space-y-2">
          {DURATIONS.map((d) => (
            <Choice
              key={d.key}
              testId={`duration-${d.days}`}
              selected={draft.durationDays === d.days}
              onClick={() => update({ durationDays: d.days })}
            >
              <span className="text-2xl" aria-hidden>
                🗓️
              </span>
              {t(d.key)}
            </Choice>
          ))}
        </div>
      )}

      {step === 'severity' && (
        <div className="space-y-2">
          {(
            [
              ['mild', '🙂'],
              ['moderate', '😣'],
              ['severe', '😫'],
            ] as const
          ).map(([s, icon]) => (
            <Choice
              key={s}
              testId={`severity-${s}`}
              selected={draft.severity === s}
              onClick={() => update({ severity: s })}
            >
              <span className="text-3xl" aria-hidden>
                {icon}
              </span>
              {t(`severity.${s}`)}
            </Choice>
          ))}
        </div>
      )}

      {step === 'person' && (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-1 font-semibold">{t('wizard.age')} *</legend>
            <div className="flex gap-2">
              <label className="flex-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  data-testid="age-years"
                  value={draft.ageYears}
                  onChange={(e) => update({ ageYears: e.target.value })}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg"
                />
                <span className="text-sm">{t('wizard.years')}</span>
              </label>
              <label className="flex-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={11}
                  data-testid="age-months"
                  value={draft.ageMonths}
                  onChange={(e) => update({ ageMonths: e.target.value })}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg"
                />
                <span className="text-sm">{t('wizard.months')}</span>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-semibold">{t('wizard.sex')} *</legend>
            <div className="grid grid-cols-3 gap-2">
              {SEXES.map((s) => (
                <Choice
                  key={s}
                  testId={`sex-${s}`}
                  selected={draft.sex === s}
                  onClick={() => update({ sex: s })}
                >
                  {t(`sex.${s}`)}
                </Choice>
              ))}
            </div>
          </fieldset>
          {askPregnancy && (
            <fieldset
              data-testid="pregnancy-question"
              className="rounded-xl border-2 border-pink-300 bg-pink-50 p-3"
            >
              <legend className="px-1 text-lg font-semibold">🤰 {t('wizard.pregnant')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {(['yes', 'no', 'unsure'] as const).map((p) => (
                  <Choice
                    key={p}
                    testId={`pregnant-${p}`}
                    selected={draft.pregnancy === p}
                    onClick={() => update({ pregnancy: p })}
                  >
                    {t(`pregnant.${p}`)}
                  </Choice>
                ))}
              </div>
              {/* "Not sure" is not a confirmed pregnancy (no pregnancy red flag), so say it plainly here. */}
              {draft.pregnancy === 'unsure' && (
                <p
                  data-testid="pregnancy-unsure-advice"
                  className="mt-3 rounded-xl bg-red-50 p-3 font-semibold text-red-900"
                >
                  🩸 {t('wizard.pregnant.unsureAdvice')}
                </p>
              )}
            </fieldset>
          )}
        </div>
      )}

      {step === 'vitals' && (
        <div className="space-y-3">
          <p className="text-slate-600">{t('wizard.vitals.hint')}</p>
          <div className="grid grid-cols-2 gap-3">
            {VITAL_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-sm font-medium">{t(`vitals.${f.key}`)}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  data-testid={`vital-${f.key}`}
                  value={draft.vitals[f.key] ?? ''}
                  onChange={(e) => update({ vitals: { ...draft.vitals, [f.key]: e.target.value } })}
                  aria-invalid={vitalError(f, draft.vitals[f.key])}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg aria-[invalid=true]:border-red-600"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-2 rounded-2xl bg-white p-4" data-testid="review">
          {draft.patientName && (
            <p>
              <span className="font-semibold">{t('wizard.review.patient')}:</span> {draft.patientName}
            </p>
          )}
          <p className="font-semibold">{t('wizard.review.symptoms')}:</p>
          <ul className="list-disc pl-5">
            {draft.symptoms.map((id) => (
              <li key={id}>{loc(symptomsById.get(id)?.label)}</li>
            ))}
          </ul>
          <p>
            {t('wizard.age')}:{' '}
            {ageMonths !== undefined
              ? `${Math.floor(ageMonths / 12)} ${t('wizard.years')} ${ageMonths % 12} ${t('wizard.months')}`
              : '—'}
            {draft.sex ? ` · ${t(`sex.${draft.sex}`)}` : ''}
          </p>
          {!online && <p className="rounded-xl bg-sky-50 p-2 text-sky-900">{t('wizard.review.offline')}</p>}
        </div>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="sticky bottom-20 flex gap-2 bg-slate-50 py-2">
        {stepIndex > 0 && (
          <Button variant="secondary" onClick={back} className="flex-1">
            ← {t('wizard.back')}
          </Button>
        )}
        {(step === 'duration' || step === 'severity' || step === 'vitals') && (
          <Button variant="ghost" onClick={() => setStepIndex((i) => i + 1)} data-testid="wizard-skip">
            {t('wizard.skip')}
          </Button>
        )}
        {step === 'review' ? (
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="flex-1"
            data-testid="wizard-submit"
          >
            {t('wizard.submit')}
          </Button>
        ) : (
          <Button onClick={next} className="flex-1" data-testid="wizard-next">
            {t('wizard.next')} →
          </Button>
        )}
      </div>
    </div>
  );
}
