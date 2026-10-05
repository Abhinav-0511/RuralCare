import { getTriageLevel, TRIAGE_LEVELS, type TriageLevelId } from '@ruralcare/shared';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { useOnline } from '../lib/connectivity';
import { useApi } from '../lib/hooks';

type Counts = Record<TriageLevelId, number>;
interface Stats {
  total: number;
  pendingReview: number;
  modelUnavailable: number;
  byLevel: Counts;
  byVillage: { villageName: string; total: number; byLevel: Counts }[];
  overTime: { date: string; total: number; byLevel: Counts }[];
}

const color = (l: TriageLevelId) => getTriageLevel(l).color;

export default function AdminPage() {
  const { t } = useI18n();
  const online = useOnline();
  const stats = useApi<Stats>(online ? '/api/dashboard/stats' : null);

  if (!online) return <p>{t('common.needsInternet')}</p>;
  if (!stats.data) return <Spinner label={t('common.loading')} />;
  const s = stats.data;
  const levelRows = TRIAGE_LEVELS.map((l) => ({
    level: l.replaceAll('_', ' '),
    count: s.byLevel[l],
    fill: color(l),
  }));
  const flat = (rows: { byLevel: Counts }[], key: string, labelOf: (r: never) => string) =>
    rows.map((r) => ({ [key]: labelOf(r as never), ...r.byLevel }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2" data-testid="stat-tiles">
        {[
          [t('admin.total'), s.total],
          [t('admin.pending'), s.pendingReview],
          [t('admin.fallback'), s.modelUnavailable],
        ].map(([label, value]) => (
          <Card key={label as string} className="text-center">
            <p className="text-3xl font-bold text-teal-800">{value}</p>
            <p className="text-xs text-slate-600">{label}</p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">{t('admin.byLevel')}</h2>
        <div className="h-52" data-testid="chart-by-level">
          <ResponsiveContainer>
            <BarChart data={levelRows} margin={{ left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" tick={{ fontSize: 9 }} interval={0} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {(
        [
          ['admin.byVillage', flat(s.byVillage, 'name', (r: { villageName: string }) => r.villageName)],
          ['admin.overTime', flat(s.overTime, 'name', (r: { date: string }) => r.date.slice(5))],
        ] as const
      ).map(([title, rows]) => (
        <Card key={title}>
          <h2 className="mb-2 font-semibold">{t(title)}</h2>
          <div className="h-64" data-testid={`chart-${title}`}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {TRIAGE_LEVELS.map((l) => (
                  <Bar key={l} dataKey={l} stackId="a" fill={color(l)} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ))}
    </div>
  );
}
