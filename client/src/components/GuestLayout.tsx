import { Link, Outlet } from 'react-router';
import { LanguageSwitch, useI18n } from '../i18n/I18nProvider';
import { ModelStatus, OnlineBadge } from './Layout';

/** Frame for triage without an account: no navigation, no sync status (nothing is synced). */
export function GuestLayout() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-slate-50">
      <header className="sticky top-0 z-10 space-y-2 bg-teal-800 px-4 pt-3 pb-3 text-white shadow">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xl font-bold">RuralCare</span>
          <LanguageSwitch />
        </div>
        <div className="flex items-center justify-between gap-2">
          <OnlineBadge />
          <Link to="/login" className="min-h-10 content-center rounded-lg px-2 text-sm underline">
            {t('guest.toLogin')}
          </Link>
        </div>
      </header>
      <main className="flex-1 px-4 py-4 pb-12">
        <p className="mb-3 rounded-xl bg-amber-50 p-2 text-sm text-amber-900" data-testid="guest-banner">
          👤 {t('guest.title')}: {t('login.guestHint')}
        </p>
        <Outlet />
        <ModelStatus />
      </main>
    </div>
  );
}
