import type { TriageLevelId } from '@ruralcare/shared';
import { Link } from 'react-router';
import { Card, formatDateTime, LevelBadge, PageTitle, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { useOnline } from '../lib/connectivity';
import { useApi } from '../lib/hooks';
import { symptomsById } from '../triage/vocabulary';

interface QueueItem {
  id: string;
  patientName: string | null;
  occurredAt: string;
  origin: string;
  input: { symptoms: string[] };
  result: { level: TriageLevelId };
}

/** Doctor review queue: unreviewed sessions, emergencies first. */
export default function ReviewPage() {
  const { t, loc, locale } = useI18n();
  const online = useOnline();
  const queue = useApi<{ items: QueueItem[]; total: number }>(
    online ? '/api/triage?reviewStatus=pending&sort=urgency&limit=50' : null,
  );

  return (
    <div className="space-y-3">
      <PageTitle>{t('doctor.queue')}</PageTitle>
      {!online && <p className="text-stone-600">{t('common.needsInternet')}</p>}
      {queue.loading && <Spinner label={t('common.loading')} />}
      {queue.data?.items.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-stone-600">
          {t('doctor.empty')}
        </p>
      )}
      <ul className="space-y-2" data-testid="review-queue">
        {queue.data?.items.map((s) => (
          <li key={s.id}>
            <Link to={`/sessions/${s.id}`} data-testid="queue-item" data-level={s.result.level}>
              <Card className="flex items-center justify-between gap-3 transition-colors hover:border-stone-300">
                <div className="min-w-0">
                  <p className="font-semibold">{s.patientName}</p>
                  <p className="truncate text-sm text-stone-700">
                    {s.input.symptoms.map((id) => loc(symptomsById.get(id)?.label) || id).join(', ')}
                  </p>
                  <p className="text-xs text-stone-600">{formatDateTime(s.occurredAt, locale)}</p>
                </div>
                <LevelBadge level={s.result.level} small />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
