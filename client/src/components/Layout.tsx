import { NavLink, Outlet } from 'react-router';
import { LanguageSwitch, useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/strings';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { useModel } from '../model/ModelProvider';
import { useSync } from '../triage/SyncProvider';

const NAV: Record<string, { to: string; label: StringKey; icon: string }[]> = {
  patient: [
    { to: '/triage', label: 'nav.triage', icon: '➕' },
    { to: '/me', label: 'nav.myHealth', icon: '❤️' },
    { to: '/history', label: 'nav.history', icon: '🕘' },
  ],
  health_worker: [
    { to: '/hw', label: 'nav.dashboard', icon: '🏠' },
    { to: '/triage', label: 'nav.triage', icon: '➕' },
    { to: '/history', label: 'nav.history', icon: '🕘' },
  ],
  doctor: [
    { to: '/review', label: 'nav.review', icon: '🩺' },
    { to: '/triage', label: 'nav.triage', icon: '➕' },
    { to: '/history', label: 'nav.history', icon: '🕘' },
  ],
  admin: [
    { to: '/admin', label: 'nav.dashboard', icon: '📊' },
    { to: '/review', label: 'nav.review', icon: '🩺' },
    { to: '/history', label: 'nav.history', icon: '🕘' },
  ],
};

export function StatusBar() {
  const online = useOnline();
  const { pending, syncing } = useSync();
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span
        data-testid="online-status"
        data-online={online}
        className={`rounded-full px-2.5 py-1 font-semibold ${online ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-700 text-white'}`}
      >
        {online ? '● ' + t('status.online') : '○ ' + t('status.offline')}
      </span>
      <span
        data-testid="pending-count"
        data-count={pending}
        className="rounded-full bg-white/90 px-2.5 py-1 text-slate-800"
      >
        {syncing
          ? t('status.syncing')
          : pending > 0
            ? `⏳ ${t('status.pending', { n: pending })}`
            : `✓ ${t('status.allSynced')}`}
      </span>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const model = useModel();
  const items = NAV[user?.role ?? 'patient'] ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-slate-50">
      <header className="sticky top-0 z-10 space-y-2 bg-teal-800 px-4 pt-3 pb-3 text-white shadow">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xl font-bold">RuralCare</span>
          <LanguageSwitch />
        </div>
        <div className="flex items-center justify-between gap-2">
          <StatusBar />
          {user && (
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-10 rounded-lg px-2 text-sm underline"
            >
              {t('nav.logout')}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-28">
        <Outlet />
        <p
          className="mt-6 text-center text-xs text-slate-500"
          data-testid="model-status"
          data-status={model.status}
        >
          {model.predictor
            ? t('model.ready', { version: model.predictor.metadata.modelVersion })
            : t('model.none')}
        </p>
      </main>

      {user && (
        <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-3xl border-t border-slate-200 bg-white">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                `flex min-h-16 flex-1 flex-col items-center justify-center text-xs ${isActive ? 'font-bold text-teal-800' : 'text-slate-600'}`
              }
            >
              <span className="text-xl" aria-hidden>
                {i.icon}
              </span>
              {t(i.label)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
