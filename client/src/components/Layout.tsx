import { NavLink, Outlet } from 'react-router';
import { LanguageSwitch, useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/strings';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { useModel } from '../model/ModelProvider';
import { useSync } from '../triage/SyncProvider';
import { GuestClaimPrompt } from './GuestClaimPrompt';
import { Icon, type IconName, LogoMark } from './Icon';

const NAV: Record<string, { to: string; label: StringKey; icon: IconName }[]> = {
  patient: [
    { to: '/triage', label: 'nav.triage', icon: 'plus' },
    { to: '/me', label: 'nav.myHealth', icon: 'heart' },
    { to: '/history', label: 'nav.history', icon: 'clock' },
  ],
  health_worker: [
    { to: '/hw', label: 'nav.dashboard', icon: 'home' },
    { to: '/triage', label: 'nav.triage', icon: 'plus' },
    { to: '/history', label: 'nav.history', icon: 'clock' },
  ],
  doctor: [
    { to: '/review', label: 'nav.review', icon: 'stethoscope' },
    { to: '/triage', label: 'nav.triage', icon: 'plus' },
    { to: '/history', label: 'nav.history', icon: 'clock' },
  ],
  admin: [
    { to: '/admin', label: 'nav.dashboard', icon: 'chart' },
    { to: '/admin/users', label: 'nav.users', icon: 'users' },
    { to: '/review', label: 'nav.review', icon: 'stethoscope' },
    { to: '/history', label: 'nav.history', icon: 'clock' },
  ],
};

const CHIP = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold';

export function OnlineBadge() {
  const online = useOnline();
  const { t } = useI18n();
  return (
    <span
      data-testid="online-status"
      data-online={online}
      className={`${CHIP} ${online ? 'bg-white/10 text-brand-50' : 'bg-amber-400 text-amber-950'}`}
    >
      <span
        className={`size-2 rounded-full ${online ? 'bg-emerald-400' : 'border-2 border-amber-950'}`}
        aria-hidden
      />
      {online ? t('status.online') : t('status.offline')}
    </span>
  );
}

export function ModelStatus() {
  const { t } = useI18n();
  const model = useModel();
  return (
    <p
      className="mt-8 text-center text-xs text-stone-500"
      data-testid="model-status"
      data-status={model.status}
    >
      {model.predictor
        ? t('model.ready', { version: model.predictor.metadata.modelVersion })
        : t('model.none')}
    </p>
  );
}

export function StatusBar() {
  const { pending, syncing } = useSync();
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <OnlineBadge />
      <span
        data-testid="pending-count"
        data-count={pending}
        className={`${CHIP} ${pending > 0 && !syncing ? 'bg-sky-100 text-sky-950' : 'bg-white/10 text-brand-50'}`}
      >
        <Icon
          name={syncing ? 'refresh' : pending > 0 ? 'clock' : 'check'}
          className={`size-3.5 ${syncing ? 'animate-spin' : ''}`}
          strokeWidth={2.4}
        />
        {syncing
          ? t('status.syncing')
          : pending > 0
            ? t('status.pending', { n: pending })
            : t('status.allSynced')}
      </span>
    </div>
  );
}

/** App header shared by the signed-in and guest layouts. */
export function AppHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 bg-brand-900 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <LogoMark className="size-8 text-brand-200" />
          RuralCare
        </span>
        <LanguageSwitch />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">{children}</div>
    </header>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const items = NAV[user?.role ?? 'patient'] ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-paper">
      <AppHeader>
        <StatusBar />
        {user && (
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-100 hover:bg-white/10 hover:text-white"
          >
            <Icon name="logout" className="size-4" />
            {t('nav.logout')}
          </button>
        )}
      </AppHeader>

      <main className="flex-1 px-4 py-5 pb-28">
        {user?.role === 'patient' && <GuestClaimPrompt />}
        <Outlet />
        <ModelStatus />
      </main>

      {user && (
        <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-3xl border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end
              className={({ isActive }) =>
                `group relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs ${isActive ? 'font-semibold text-brand-800' : 'text-stone-500 hover:text-stone-800'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute inset-x-6 top-0 h-0.5 rounded-b ${isActive ? 'bg-brand-700' : 'bg-transparent'}`}
                    aria-hidden
                  />
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-brand-50' : ''}`}
                  >
                    <Icon name={i.icon} className="size-[1.375rem]" strokeWidth={isActive ? 2.1 : 1.8} />
                  </span>
                  {t(i.label)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
