import { Link } from 'react-router';
import { formatDateTime, LevelBadge } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { db, type LocalSession } from '../lib/db';
import { useLiveQuery } from '../lib/hooks';

export default function HistoryPage() {
  const { t, locale } = useI18n();
  const sessions = useLiveQuery(
    () => db.sessions.orderBy('createdAt').reverse().limit(200).toArray(),
    [],
    [] as LocalSession[],
  );

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{t('history.title')}</h1>
      {sessions.length === 0 && <p className="text-slate-600">{t('history.empty')}</p>}
      <ul className="space-y-2" data-testid="history-list">
        {sessions.map((s) => (
          <li key={s.clientId}>
            <Link
              to={`/result/${s.clientId}`}
              className="flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm"
            >
              <div>
                <p className="font-semibold">{s.patientName ?? '—'}</p>
                <p className="text-sm text-slate-600">{formatDateTime(s.createdAt, locale)}</p>
                <p className="text-xs text-slate-600">{t(`source.${s.source}`)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <LevelBadge level={s.serverLevel ?? s.level} small />
                {s.syncStatus === 'pending' && (
                  <span className="text-xs text-sky-800">⏳ {t('history.pending')}</span>
                )}
                {s.syncStatus === 'rejected' && (
                  <span className="text-xs text-red-800">{t('history.rejected')}</span>
                )}
                {s.verdictChanged && (
                  <span className="text-xs font-semibold text-red-800">⚠️ {t('history.differs')}</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
