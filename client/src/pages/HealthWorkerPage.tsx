import type { LocalizedText, TriageLevelId } from '@ruralcare/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, Card, ErrorBox, formatDateTime, LevelBadge, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../lib/api';
import { useOnline } from '../lib/connectivity';
import { useApi, usePatients } from '../lib/hooks';

interface AlertDto {
  id: string;
  patientId: string;
  patientName: string | null;
  code: string;
  severity: 'warning' | 'critical';
  value: number;
  label: LocalizedText | null;
  lastSeenAt: string;
  count: number;
}
interface SessionDto {
  id: string;
  patientId: string;
  patientName: string | null;
  occurredAt: string;
  result: { level: TriageLevelId };
}

export default function HealthWorkerPage() {
  const { t, loc, locale } = useI18n();
  const online = useOnline();
  const patients = usePatients();
  const alerts = useApi<{ items: AlertDto[] }>(online ? '/api/alerts?acknowledged=false&limit=50' : null);
  const recent = useApi<{ items: SessionDto[] }>(online ? '/api/triage?limit=10' : null);
  const [ackError, setAckError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const registered = params.get('registered');

  const acknowledge = async (id: string) => {
    try {
      await api(`/api/alerts/${id}`, { method: 'PATCH', body: { acknowledged: true } });
      alerts.reload();
    } catch (err) {
      setAckError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {registered && (
        <p
          role="status"
          data-testid="registered-banner"
          className="rounded-xl bg-emerald-50 p-3 text-emerald-900"
        >
          ✓ {t('reg.done', { name: registered })}
        </p>
      )}
      <Link to="/hw/register" className="block">
        <Button className="w-full" data-testid="register-patient-button" disabled={!online}>
          ➕ {t('hw.register')}
        </Button>
      </Link>
      <Card>
        <h2 className="mb-2 text-lg font-bold">🚨 {t('hw.alerts')}</h2>
        {!online && <p className="text-slate-600">{t('common.needsInternet')}</p>}
        {alerts.loading && <Spinner label={t('common.loading')} />}
        {ackError && <ErrorBox>{ackError}</ErrorBox>}
        {alerts.data?.items.length === 0 && <p className="text-slate-600">{t('hw.noAlerts')}</p>}
        <ul className="space-y-2" data-testid="alerts-list">
          {alerts.data?.items.map((a) => (
            <li
              key={a.id}
              data-testid="alert-item"
              className={`flex items-center justify-between gap-2 rounded-xl p-3 ${a.severity === 'critical' ? 'bg-red-50' : 'bg-amber-50'}`}
            >
              <div>
                <Link to={`/patients/${a.patientId}`} className="font-semibold underline">
                  {a.patientName}
                </Link>
                <p className={a.severity === 'critical' ? 'font-semibold text-red-800' : 'text-amber-900'}>
                  {loc(a.label)}: {a.value} {a.count > 1 ? `(×${a.count})` : ''}
                </p>
                <p className="text-xs text-slate-600">{formatDateTime(a.lastSeenAt, locale)}</p>
              </div>
              <Button variant="secondary" onClick={() => void acknowledge(a.id)} data-testid="ack-alert">
                {t('hw.ack')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('hw.recent')}</h2>
        {!online && <p className="text-slate-600">{t('common.needsInternet')}</p>}
        <ul className="space-y-1">
          {recent.data?.items.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sessions/${s.id}`}
                className="flex min-h-12 items-center justify-between gap-2 rounded-lg px-1"
              >
                <span>
                  {s.patientName}{' '}
                  <span className="text-xs text-slate-600">{formatDateTime(s.occurredAt, locale)}</span>
                </span>
                <LevelBadge level={s.result.level} small />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('hw.patients')}</h2>
        <ul className="divide-y divide-slate-100" data-testid="patients-list">
          {patients.map((p) => (
            <li key={p.id} className="flex min-h-14 items-center justify-between gap-2">
              <Link to={`/patients/${p.id}`} className="font-medium underline">
                {p.name}
                <span className="ml-1 text-sm font-normal text-slate-600">
                  {t('patient.years', { n: Math.floor(p.ageMonths / 12) })}
                </span>
              </Link>
              <Link to={`/triage?patient=${p.id}`}>
                <Button variant="secondary">{t('hw.triage')}</Button>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
