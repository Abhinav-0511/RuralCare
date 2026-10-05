import { type AlertVital, thresholdsFor, type TriageLevelId } from '@ruralcare/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TempPasswordCard } from '../components/TempPasswordCard';
import { Button, Card, ErrorBox, formatDateTime, LevelBadge, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/strings';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { useApi } from '../lib/hooks';

interface Point {
  time: string;
  heartRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
}
interface PatientDto {
  id: string;
  name: string;
  ageMonths: number;
  sex: string;
  phone?: string;
  userId?: string;
}

/** Health worker / admin: a patient's login, with a password reset (new temporary password). */
function LoginCard({ patient }: { patient: PatientDto }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [temp, setTemp] = useState<{ phone: string; temporaryPassword: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setError(null);
    try {
      setTemp(await api(`/api/patients/${patient.id}/reset-password`, { method: 'POST' }));
      setConfirming(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (temp)
    return (
      <TempPasswordCard phone={temp.phone} password={temp.temporaryPassword} onDone={() => setTemp(null)} />
    );
  return (
    <Card>
      <h2 className="mb-2 font-semibold">{t('patient.login')}</h2>
      {!patient.userId ? (
        <p className="text-slate-600">{t('patient.noLogin')}</p>
      ) : (
        <div className="space-y-2">
          <p className="font-mono">{patient.phone}</p>
          {confirming ? (
            <>
              <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{t('patient.resetConfirm')}</p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => void reset()}
                  data-testid="confirm-reset-password"
                >
                  {t('patient.resetPassword')}
                </Button>
              </div>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)} data-testid="reset-password">
              {t('patient.resetPassword')}
            </Button>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
        </div>
      )}
    </Card>
  );
}

const CHARTS: { vitals: AlertVital[]; label: StringKey; domain: [number, number] }[] = [
  { vitals: ['spo2'], label: 'vitals.spo2', domain: [80, 100] },
  { vitals: ['heartRate'], label: 'vitals.heartRate', domain: [30, 200] },
  { vitals: ['temperatureC'], label: 'vitals.temperatureC', domain: [35, 42] },
  { vitals: ['systolicBp', 'diastolicBp'], label: 'vitals.systolicBp', domain: [40, 200] },
];
const COLORS: Record<string, string> = { systolicBp: '#0f766e', diastolicBp: '#7c3aed' };

const SEVEN_DAYS = 7 * 24 * 3600 * 1000;

/** Patient page: hourly vital averages (continuous aggregate) with age-aware threshold lines. */
export default function PatientPage() {
  const params = useParams();
  const { user } = useAuth();
  const id = params.id ?? user?.patientId ?? '';
  const { t, locale } = useI18n();
  const online = useOnline();
  const patient = useApi<PatientDto>(online && id ? `/api/patients/${id}` : null);
  const [from] = useState(() =>
    new Date(Math.floor((Date.now() - SEVEN_DAYS) / 3_600_000) * 3_600_000).toISOString(),
  );
  const vitals = useApi<{ points: Point[] }>(
    online && id ? `/api/vitals/${id}?bucket=1h&from=${from}` : null,
  );
  const sessions = useApi<{ items: { id: string; occurredAt: string; result: { level: TriageLevelId } }[] }>(
    online && id ? `/api/triage?patientId=${id}&limit=10` : null,
  );

  if (!online) return <p>{t('common.needsInternet')}</p>;
  if (!patient.data) return <Spinner label={t('common.loading')} />;
  const thresholds = thresholdsFor(patient.data.ageMonths);
  const points = (vitals.data?.points ?? []).map((p) => ({
    ...p,
    label: new Date(p.time).toLocaleString(locale === 'en' ? 'en-IN' : `${locale}-IN`, {
      day: 'numeric',
      hour: '2-digit',
    }),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{patient.data.name}</h1>
        <p className="text-slate-600">{t('patient.years', { n: Math.floor(patient.data.ageMonths / 12) })}</p>
      </div>

      {(user?.role === 'health_worker' || user?.role === 'admin') && <LoginCard patient={patient.data} />}

      <Card>
        <h2 className="mb-2 font-semibold">{t('patient.vitals')}</h2>
        {vitals.data && points.length === 0 && <p className="text-slate-600">{t('patient.noVitals')}</p>}
        {vitals.error && <p className="text-slate-600">{vitals.error}</p>}
        {points.length > 0 &&
          CHARTS.map((c) => (
            <figure key={c.label} className="mb-4" data-testid={`chart-${c.vitals[0]}`}>
              <figcaption className="text-sm font-medium">
                {c.vitals.map((v) => t(`vitals.${v}` as StringKey)).join(' / ')}
              </figcaption>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis domain={c.domain} tick={{ fontSize: 10 }} allowDataOverflow />
                    <Tooltip />
                    {c.vitals.map((v) => (
                      <Line
                        key={v}
                        type="monotone"
                        dataKey={v}
                        stroke={COLORS[v] ?? '#0f766e'}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                    {thresholds
                      .filter((th) => c.vitals.includes(th.vital))
                      .map((th) => (
                        <ReferenceLine
                          key={th.code}
                          y={th.value}
                          stroke={th.severity === 'critical' ? '#b91c1c' : '#d97706'}
                          strokeDasharray="4 4"
                          label={{
                            value: `${th.value} ${t(`patient.${th.severity}`)}`,
                            fontSize: 10,
                            position: 'insideTopRight',
                          }}
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </figure>
          ))}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t('patient.sessions')}</h2>
        <ul>
          {sessions.data?.items.map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`} className="flex min-h-12 items-center justify-between">
                {formatDateTime(s.occurredAt, locale)} <LevelBadge level={s.result.level} small />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
