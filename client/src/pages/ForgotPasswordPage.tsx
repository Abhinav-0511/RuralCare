import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, ErrorBox } from '../components/ui';
import { LanguageSwitch, useI18n } from '../i18n/I18nProvider';
import { api, ApiError } from '../lib/api';
import { useOnline } from '../lib/connectivity';
import { PasswordField } from '../components/PasswordField';
import { newPasswordProblem } from '../lib/passwordRules';

const PHONE = /^[6-9]\d{9}$/;
const normalizePhone = (s: string) => s.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');

/** Forgot password: SMS code, then a new password. The answer never says whether the number exists. */
export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const online = useOnline();
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<{ minutes: number; devOtp?: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) =>
    setError(
      err instanceof ApiError && err.status === 429
        ? t('common.tooMany')
        : err instanceof ApiError && err.code === 'INVALID_OTP'
          ? t('forgot.invalid')
          : err instanceof ApiError
            ? t('common.error')
            : t('common.needsInternet'),
    );

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!PHONE.test(normalizePhone(phone))) return setError(t('common.phoneInvalid'));
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ expiresInSeconds: number; devOtp?: string }>(
        '/api/auth/password-reset/request',
        {
          method: 'POST',
          body: { phone },
          auth: false,
        },
      );
      setSent({
        minutes: Math.round(res.expiresInSeconds / 60),
        ...(res.devOtp ? { devOtp: res.devOtp } : {}),
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    const problem = !/^\d{6}$/.test(otp) ? 'forgot.invalid' : newPasswordProblem(next, repeat);
    if (problem) return setError(t(problem));
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: { phone, otp, newPassword: next },
        auth: false,
      });
      setDone(true);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const input = 'min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg';
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-teal-800 px-4 py-8">
      <div className="mb-4 flex items-center justify-between text-white">
        <h1 className="text-3xl font-bold">RuralCare</h1>
        <LanguageSwitch />
      </div>
      <Card>
        <div className="space-y-4" data-testid="forgot-password">
          <h2 className="text-xl font-semibold">{t('forgot.title')}</h2>
          {!online && <ErrorBox>{t('common.needsInternet')}</ErrorBox>}
          {done ? (
            <p
              role="status"
              data-testid="reset-done"
              className="rounded-xl bg-emerald-50 p-3 text-emerald-900"
            >
              ✓ {t('forgot.done')}
            </p>
          ) : !sent ? (
            <form onSubmit={requestCode} className="space-y-4">
              <p className="text-slate-700">{t('forgot.hint')}</p>
              <label className="block">
                <span className="mb-1 block font-medium">{t('login.phone')}</span>
                <input
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="username"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={input}
                  required
                />
              </label>
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button type="submit" disabled={busy || !online} className="w-full" data-testid="send-code">
                {t('forgot.send')}
              </Button>
            </form>
          ) : (
            <form onSubmit={confirm} className="space-y-4">
              <p className="rounded-xl bg-sky-50 p-3 text-sky-900">
                {t('forgot.sent', { min: sent.minutes })}
              </p>
              {sent.devOtp && (
                <p data-testid="dev-otp" className="rounded-xl bg-amber-50 p-3 font-mono text-amber-900">
                  {t('forgot.devCode', { code: sent.devOtp })}
                </p>
              )}
              <label className="block">
                <span className="mb-1 block font-medium">{t('forgot.code')}</span>
                <input
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className={`${input} tracking-widest`}
                  required
                />
              </label>
              <PasswordField
                name="newPassword"
                label={t('pw.new')}
                value={next}
                onChange={setNext}
                autoComplete="new-password"
              />
              <PasswordField
                name="repeatPassword"
                label={t('pw.repeat')}
                value={repeat}
                onChange={setRepeat}
                autoComplete="new-password"
              />
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button type="submit" disabled={busy || !online} className="w-full" data-testid="confirm-reset">
                {t('forgot.confirm')}
              </Button>
            </form>
          )}
          <p className="text-sm text-slate-600">{t('forgot.noPhone')}</p>
          <Link to="/login" className="block text-center font-semibold text-teal-800 underline">
            {t('forgot.back')}
          </Link>
        </div>
      </Card>
    </main>
  );
}
