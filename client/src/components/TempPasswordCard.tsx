import { useI18n } from '../i18n/I18nProvider';
import { Button } from './ui';
import { Icon } from './Icon';

/** A temporary password, shown once to the health worker or admin who created/reset it. */
export function TempPasswordCard(props: { phone: string; password: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <section
      role="alert"
      data-testid="temp-password-card"
      className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4"
    >
      <h2 className="flex items-center gap-2 text-lg font-bold text-amber-950">
        <Icon name="key" className="size-5" />
        {t('temp.title')}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2 rounded-lg bg-white p-3">
        <dt className="text-stone-700">{t('temp.login')}</dt>
        <dd className="font-mono text-lg font-semibold" data-testid="temp-phone">
          {props.phone}
        </dd>
        <dt className="text-stone-700">{t('temp.password')}</dt>
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
