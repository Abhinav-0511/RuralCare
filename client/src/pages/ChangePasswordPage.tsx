import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, ErrorBox } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { api, ApiError, type Tokens, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { newPasswordProblem } from '../lib/passwordRules';
import { PasswordField } from '../components/PasswordField';

/** Shown right after logging in with a temporary password; nothing else is reachable until done. */
export default function ChangePasswordPage() {
  const { t } = useI18n();
  const { user, setSession } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(next, repeat) ?? (next === current ? 'pw.same' : null);
    if (problem) return setError(t(problem));
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: User; tokens: Tokens }>('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setSession(res.user, res.tokens);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
          ? t('pw.wrongCurrent')
          : t('common.error'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" data-testid="change-password">
        <h1 className="text-xl font-semibold">{t('pw.title')}</h1>
        {user?.mustChangePassword && <p className="text-slate-700">{t('pw.hint')}</p>}
        <PasswordField
          name="currentPassword"
          label={t('pw.current')}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
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
        <Button type="submit" disabled={busy} className="w-full" data-testid="save-password">
          {t('pw.save')}
        </Button>
      </form>
    </Card>
  );
}
