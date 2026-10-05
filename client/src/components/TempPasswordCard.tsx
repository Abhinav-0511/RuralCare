import { useI18n } from '../i18n/I18nProvider';
import { Button } from './ui';

/** A temporary password, shown once to the health worker or admin who created/reset it. */
export function TempPasswordCard(props: { phone: string; password: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <section
      role="alert"
      data-testid="temp-password-card"
      className="space-y-3 rounded-2xl border-4 border-amber-500 bg-amber-50 p-4"
    >
      <h2 className="text-lg font-bold text-amber-900">🔑 {t('temp.title')}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-700">{t('temp.login')}</dt>
        <dd className="font-mono text-lg font-semibold" data-testid="temp-phone">
          {props.phone}
        </dd>
        <dt className="text-slate-700">{t('temp.password')}</dt>
        <dd className="font-mono text-2xl font-bold tracking-wider select-all" data-testid="temp-password">
          {props.password}
        </dd>
      </dl>
      <p className="text-sm text-amber-900">{t('temp.hint')}</p>
      <Button className="w-full" onClick={props.onDone} data-testid="temp-done">
        {t('temp.done')}
      </Button>
    </section>
  );
}
