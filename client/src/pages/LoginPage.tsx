import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Icon, LogoMark } from '../components/Icon';
import { Button, Card, ErrorBox } from '../components/ui';
import { LanguageSwitch, useI18n } from '../i18n/I18nProvider';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';

export default function LoginPage() {
  const { user, login } = useAuth();
  const { t } = useI18n();
  const online = useOnline();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? t('login.error') : t('login.offline'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-paper">
      <div className="bg-brand-900 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-24 text-white">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <LogoMark className="size-9 text-brand-200" />
            <h1 className="text-2xl font-bold tracking-tight">RuralCare</h1>
          </span>
          <LanguageSwitch />
        </div>
        <p className="mx-auto mt-6 max-w-md text-lg leading-snug text-brand-100">{t('app.tagline')}</p>
      </div>
      <main className="mx-auto -mt-16 max-w-md space-y-4 px-4 pb-10">
        <Card className="p-5 shadow-sm">
          <form onSubmit={submit} className="space-y-4">
            <h2 className="text-xl font-bold">{t('login.title')}</h2>
            {!online && <ErrorBox>{t('login.offline')}</ErrorBox>}
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-stone-700">{t('login.phone')}</span>
              <input
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="username"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-h-12 w-full rounded-lg border border-stone-300 px-3 text-lg tracking-wide"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-stone-700">{t('login.password')}</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-12 w-full rounded-lg border border-stone-300 px-3 text-lg"
                required
              />
            </label>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Button type="submit" disabled={busy} className="w-full">
              {t('login.submit')}
            </Button>
            <Link
              to="/forgot-password"
              className="block text-center text-sm font-semibold text-brand-800 underline-offset-4 hover:underline"
            >
              {t('login.forgot')}
            </Link>
          </form>
        </Card>
        <Card className="space-y-3 p-5">
          {/* Works offline too: the wizard, rules and model are on the device. */}
          <Link to="/guest" className="block" data-testid="guest-start">
            <Button variant="secondary" className="w-full">
              <Icon name="stethoscope" className="size-5" />
              {t('login.guest')}
            </Button>
          </Link>
          <p className="text-sm text-stone-600">{t('login.guestHint')}</p>
          <p className="flex gap-2 border-t border-stone-100 pt-3 text-sm text-stone-700">
            <Icon name="info" className="mt-0.5 size-4 text-brand-700" />
            <span>{t('login.newUser')}</span>
          </p>
        </Card>
      </main>
    </div>
  );
}
