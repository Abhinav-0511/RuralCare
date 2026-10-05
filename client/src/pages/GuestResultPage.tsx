import { Link, useParams } from 'react-router';
import { ResultView } from '../components/ResultView';
import { Button, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { db, type GuestCheck } from '../lib/db';
import { useLiveQuery } from '../lib/hooks';

/** Result of a check without an account: same view, clearly marked as not saved to a record. */
export default function GuestResultPage() {
  const { clientId = '' } = useParams();
  const { t } = useI18n();
  const check = useLiveQuery<GuestCheck | undefined | null>(
    () => db.guestChecks.get(clientId),
    [clientId],
    null,
  );

  if (check === null) return <Spinner label={t('common.loading')} />;
  if (!check) return <p>{t('result.notFound')}</p>;

  return (
    <div className="space-y-4">
      <p
        data-testid="guest-not-saved"
        className="rounded-xl border-2 border-slate-400 bg-white p-3 font-semibold text-slate-800"
      >
        📵 {t('guest.notSaved')}
        <span className="block text-sm font-normal text-slate-600">{t('guest.notSavedDetail')}</span>
      </p>
      <ResultView level={check.level} guidance={check.guidance} source={check.source} />
      <p data-testid="guest-register-hint" className="rounded-xl bg-teal-50 p-3 text-teal-900">
        🏥 {t('guest.registerHint')}
      </p>
      <Link to="/guest" className="block">
        <Button className="w-full">{t('guest.newCheck')}</Button>
      </Link>
      <Link to="/login" className="block">
        <Button variant="secondary" className="w-full">
          {t('guest.toLogin')}
        </Button>
      </Link>
    </div>
  );
}
