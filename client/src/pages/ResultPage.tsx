import { getTriageLevel } from '@ruralcare/shared';
import { Link, useParams } from 'react-router';
import { ResultView } from '../components/ResultView';
import { Button, LevelBadge, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { db, type LocalSession } from '../lib/db';
import { useLiveQuery } from '../lib/hooks';

export default function ResultPage() {
  const { clientId = '' } = useParams();
  const { t, loc } = useI18n();
  const session = useLiveQuery<LocalSession | undefined | null>(
    () => db.sessions.get(clientId),
    [clientId],
    null,
  );

  if (session === null) return <Spinner label={t('common.loading')} />;
  if (!session) return <p>{t('result.notFound')}</p>;

  const differs = session.verdictChanged && session.serverLevel;
  return (
    <div className="space-y-4">
      {differs && (
        <section
          role="alert"
          data-testid="verdict-changed"
          className="space-y-2 rounded-2xl border-4 border-red-700 bg-red-50 p-4"
        >
          <p className="font-semibold text-red-900">
            {t('result.differs', { level: loc(getTriageLevel(session.serverLevel!).title) })}
          </p>
          <LevelBadge level={session.serverLevel!} />
          <p>{loc(getTriageLevel(session.serverLevel!).advice)}</p>
          {!session.differenceSeen && (
            <Button
              variant="secondary"
              onClick={() => void db.sessions.update(clientId, { differenceSeen: true })}
            >
              {t('result.differsOk')}
            </Button>
          )}
        </section>
      )}
      {session.patientName && <p className="text-lg font-semibold">{session.patientName}</p>}
      <ResultView
        level={session.level}
        guidance={session.guidance}
        source={session.source}
        syncStatus={session.syncStatus}
      />
      <Link to="/triage" className="block">
        <Button className="w-full">{t('result.newTriage')}</Button>
      </Link>
    </div>
  );
}
