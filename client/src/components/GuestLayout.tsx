import { Link, Outlet } from 'react-router';
import { useI18n } from '../i18n/I18nProvider';
import { Icon } from './Icon';
import { AppHeader, ModelStatus, OnlineBadge } from './Layout';

/** Frame for triage without an account: no navigation, no sync status (nothing is synced). */
export function GuestLayout() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-paper">
      <AppHeader>
        <OnlineBadge />
        <Link
          to="/login"
          className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-brand-100 underline-offset-4 hover:bg-white/10 hover:text-white hover:underline"
        >
          {t('guest.toLogin')}
        </Link>
      </AppHeader>
      <main className="flex-1 px-4 py-5 pb-12">
        <p
          className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          data-testid="guest-banner"
        >
          <Icon name="user" className="mt-0.5 size-4" />
          <span>
            <span className="font-semibold">{t('guest.title')}:</span> {t('login.guestHint')}
          </span>
        </p>
        <Outlet />
        <ModelStatus />
      </main>
    </div>
  );
}
