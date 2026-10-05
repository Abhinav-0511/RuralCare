import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
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
    <main className="mx-auto min-h-dvh max-w-md bg-teal-800 px-4 py-8">
      <div className="mb-6 flex items-center justify-between text-white">
        <div>
          <h1 className="text-3xl font-bold">RuralCare</h1>
          <p className="text-teal-100">{t('app.tagline')}</p>
        </div>
      </div>
      <div className="mb-4 flex justify-end">
        <LanguageSwitch />
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-xl font-semibold">{t('login.title')}</h2>
          {!online && <ErrorBox>{t('login.offline')}</ErrorBox>}
          <label className="block">
            <span className="mb-1 block font-medium">{t('login.phone')}</span>
            <input
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="username"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">{t('login.password')}</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg"
              required
            />
          </label>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" disabled={busy} className="w-full">
            {t('login.submit')}
          </Button>
          <Link to="/forgot-password" className="block text-center font-semibold text-teal-800 underline">
            {t('login.forgot')}
          </Link>
        </form>
      </Card>
      <Card className="mt-4 space-y-3">
        {/* Works offline too: the wizard, rules and model are on the device. */}
        <Link to="/guest" className="block" data-testid="guest-start">
          <Button variant="secondary" className="w-full">
            🩺 {t('login.guest')}
          </Button>
        </Link>
        <p className="text-sm text-slate-600">{t('login.guestHint')}</p>
        <p className="text-sm text-slate-700">{t('login.newUser')}</p>
      </Card>
    </main>
  );
}
