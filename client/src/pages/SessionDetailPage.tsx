import type { TriageContext, TriageLevelId } from '@ruralcare/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ResultView } from '../components/ResultView';
import { Button, Card, ErrorBox, formatDateTime, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import type { GuidanceView } from '../lib/db';
import { useApi } from '../lib/hooks';
import { serverSourceToView } from '../triage/submit';
import { symptomsById } from '../triage/vocabulary';

interface SessionDetail {
  session: {
    id: string;
    patientId: string;
    occurredAt: string;
    input: TriageContext;
    vitalsSource?: string | null;
    result: { level: TriageLevelId; source: 'rule_engine' | 'model' | 'rule_engine_fallback' };
    review: { status: 'pending' | 'reviewed'; notes: { _id: string; text: string; createdAt: string }[] };
  };
  guidance: GuidanceView;
}

export default function SessionDetailPage() {
  const { id = '' } = useParams();
  const { t, loc, locale } = useI18n();
  const { user } = useAuth();
  const online = useOnline();
  const detail = useApi<SessionDetail>(online ? `/api/triage/${id}` : null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isDoctor = user?.role === 'doctor';

  if (!online) return <p>{t('common.needsInternet')}</p>;
  if (detail.loading || !detail.data)
    return detail.error ? <ErrorBox>{detail.error}</ErrorBox> : <Spinner label={t('common.loading')} />;
  const { session, guidance } = detail.data;

  const act = async (path: string, body: object) => {
    setError(null);
    try {
      await api(`/api/triage/${id}/${path}`, { method: 'POST', body });
      setNote('');
      detail.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Link to={`/patients/${session.patientId}`} className="text-teal-800 underline">
        👤 {t('wizard.review.patient')}
      </Link>
      <ResultView
        level={session.result.level}
        guidance={guidance}
        source={serverSourceToView(session.result.source)}
      />

      <Card>
        <h2 className="font-semibold">{t('doctor.input')}</h2>
        <p className="text-sm text-slate-600">{formatDateTime(session.occurredAt, locale)}</p>
        <ul className="mt-2 list-disc pl-5">
          {session.input.symptoms.map((s) => (
            <li key={s}>{loc(symptomsById.get(s)?.label) || s}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm">
          {session.input.ageMonths !== undefined &&
            t('patient.years', { n: Math.floor(session.input.ageMonths / 12) })}
          {session.input.sex ? ` · ${t(`sex.${session.input.sex}`)}` : ''}
          {session.input.temperatureC ? ` · ${session.input.temperatureC} °C` : ''}
          {session.input.vitals?.spo2 ? ` · SpO₂ ${session.input.vitals.spo2}%` : ''}
          {session.input.vitals?.heartRate ? ` · ${session.input.vitals.heartRate} bpm` : ''}
        </p>
      </Card>

      <Card>
        <h2 className="font-semibold">{t('doctor.notes')}</h2>
        <ul className="mt-2 space-y-2" data-testid="notes">
          {session.review.notes.map((n) => (
            <li key={n._id} className="rounded-lg bg-slate-50 p-2">
              {n.text}
              <span className="block text-xs text-slate-600">{formatDateTime(n.createdAt, locale)}</span>
            </li>
          ))}
        </ul>
        {isDoctor && (
          <div className="mt-3 space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('doctor.notePlaceholder')}
              data-testid="note-input"
              className="min-h-24 w-full rounded-xl border border-slate-300 p-3"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!note.trim()}
                onClick={() => void act('notes', { text: note })}
                data-testid="add-note"
              >
                {t('doctor.addNote')}
              </Button>
              {session.review.status === 'pending' ? (
                <Button
                  onClick={() => void act('review', note.trim() ? { note } : {})}
                  data-testid="mark-reviewed"
                >
                  {t('doctor.markReviewed')}
                </Button>
              ) : (
                <span data-testid="reviewed" className="self-center font-semibold text-emerald-800">
                  ✓ {t('doctor.reviewed')}
                </span>
              )}
            </div>
          </div>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </Card>
    </div>
  );
}
