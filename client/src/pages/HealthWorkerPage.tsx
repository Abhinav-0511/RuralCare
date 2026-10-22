import type { LocalizedText, TriageLevelId } from '@ruralcare/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import {
  Button,
  Card,
  CardTitle,
  ErrorBox,
  formatDateTime,
  LevelBadge,
  Notice,
  Spinner,
} from '../components/ui';
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

  const openAlerts = alerts.data?.items.length ?? 0;

  return (
    <div className="space-y-4">
      {registered && (
        <Notice tone="success" icon="check" role="status" data-testid="registered-banner">
          {t('reg.done', { name: registered })}
        </Notice>
      )}
      <Link to="/hw/register" className="block">
        <Button className="w-full" data-testid="register-patient-button" disabled={!online}>
          <Icon name="plus" className="size-5" strokeWidth={2.2} />
          {t('hw.register')}
        </Button>
      </Link>
      <Card className={openAlerts > 0 ? 'border-red-200' : ''}>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Icon name="alert" className={`size-5 ${openAlerts > 0 ? 'text-red-700' : 'text-stone-400'}`} />
          {t('hw.alerts')}
          {openAlerts > 0 && (
            <span className="ml-auto rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
              {openAlerts}
            </span>
          )}
        </h2>
        {!online && <p className="text-stone-600">{t('common.needsInternet')}</p>}
        {alerts.loading && <Spinner label={t('common.loading')} />}
        {ackError && <ErrorBox>{ackError}</ErrorBox>}
        {alerts.data?.items.length === 0 && <p className="text-stone-600">{t('hw.noAlerts')}</p>}
        <ul className="space-y-2" data-testid="alerts-list">
          {alerts.data?.items.map((a) => (
            <li
              key={a.id}
              data-testid="alert-item"
              className={`flex items-center justify-between gap-3 rounded-lg border-l-4 p-3 ${a.severity === 'critical' ? 'border-red-600 bg-red-50' : 'border-amber-500 bg-amber-50'}`}
            >
              <div className="min-w-0">
                <Link
                  to={`/patients/${a.patientId}`}
                  className="font-semibold text-stone-900 underline-offset-4 hover:underline"
                >
                  {a.patientName}
                </Link>
                <p className={a.severity === 'critical' ? 'font-semibold text-red-800' : 'text-amber-900'}>
                  {loc(a.label)}: {a.value} {a.count > 1 ? `(×${a.count})` : ''}
                </p>
                <p className="text-xs text-stone-600">{formatDateTime(a.lastSeenAt, locale)}</p>
              </div>
              <Button variant="secondary" onClick={() => void acknowledge(a.id)} data-testid="ack-alert">
                {t('hw.ack')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle icon="clock">{t('hw.recent')}</CardTitle>
        {!online && <p className="text-stone-600">{t('common.needsInternet')}</p>}
        <ul className="-mx-1 divide-y divide-stone-100">
          {recent.data?.items.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sessions/${s.id}`}
                className="flex min-h-14 items-center justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-stone-50"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{s.patientName}</span>
                  <span className="block text-xs text-stone-500">{formatDateTime(s.occurredAt, locale)}</span>
                </span>
                <LevelBadge level={s.result.level} small />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle icon="users">{t('hw.patients')}</CardTitle>
        <ul className="divide-y divide-stone-100" data-testid="patients-list">
          {patients.map((p) => (
            <li key={p.id} className="flex min-h-14 items-center justify-between gap-2 py-1">
              <Link
                to={`/patients/${p.id}`}
                className="flex min-w-0 items-center gap-3 font-medium underline-offset-4 hover:underline"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-800"
                  aria-hidden
                >
                  {p.name.trim().charAt(0).toUpperCase()}
                </span>
                <span>
                  {p.name}
                  <span className="ml-1 text-sm font-normal text-stone-500">
                    {t('patient.years', { n: Math.floor(p.ageMonths / 12) })}
                  </span>
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
