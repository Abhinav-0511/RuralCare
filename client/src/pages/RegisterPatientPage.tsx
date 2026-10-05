import { LOCALES, SEXES, type Sex } from '@ruralcare/shared';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { TempPasswordCard } from '../components/TempPasswordCard';
import { Button, Card, ErrorBox, Spinner } from '../components/ui';
import { LOCALE_NAMES, useI18n } from '../i18n/I18nProvider';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { useApi } from '../lib/hooks';

interface Village {
  id: string;
  name: string;
  district: string;
}
interface Created {
  id: string;
  name: string;
  login?: { phone: string; temporaryPassword: string };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Health worker: register a patient in one of their villages, optionally with a login. */
export default function RegisterPatientPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const villages = useApi<Village[]>(online ? '/api/villages' : null);
  const mine = (villages.data ?? []).filter((v) => user?.role === 'admin' || user?.villageIds.includes(v.id));

  const [form, setForm] = useState({
    name: '',
    phone: '',
    villageId: '',
    sex: '' as Sex | '',
    dateOfBirth: '',
    preferredLanguage: 'ta' as (typeof LOCALES)[number],
    createLogin: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDuplicate(false);
  };
  const villageId = form.villageId || (mine.length === 1 ? mine[0]!.id : '');

  const submit = async (e?: FormEvent, allowDuplicatePhone = false) => {
    e?.preventDefault();
    if (!form.name.trim() || !villageId || !form.sex || !form.dateOfBirth) return setError(t('reg.required'));
    if (form.createLogin && !form.phone.trim()) return setError(t('reg.phoneForLogin'));
    setBusy(true);
    setError(null);
    try {
      const res = await api<Created>('/api/patients', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          sex: form.sex,
          dateOfBirth: form.dateOfBirth,
          villageId,
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          ...(form.createLogin ? { createLogin: true, preferredLanguage: form.preferredLanguage } : {}),
          ...(allowDuplicatePhone ? { allowDuplicatePhone: true } : {}),
        },
      });
      setDuplicate(false);
      setCreated(res);
      if (!res.login) navigate(`/hw?registered=${encodeURIComponent(res.name)}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_PHONE') {
        setDuplicate(true);
        setError(t('reg.duplicate'));
      } else if (err instanceof ApiError && err.code === 'PHONE_TAKEN') {
        setError(t('reg.phoneTaken'));
      } else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setError(t('common.phoneInvalid'));
      } else {
        setError(err instanceof ApiError ? err.message : t('common.needsInternet'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!online) return <p>{t('common.needsInternet')}</p>;
  if (!villages.data) return <Spinner label={t('common.loading')} />;
  if (created?.login) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">
          ✓ {t('reg.done', { name: created.name })}
        </p>
        <TempPasswordCard
          phone={created.login.phone}
          password={created.login.temporaryPassword}
          onDone={() => navigate('/hw')}
        />
      </div>
    );
  }

  const field = 'min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg';
  const label = 'mb-1 block font-medium';
  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="register-patient">
        <h1 className="text-xl font-bold">{t('hw.register')}</h1>
        <label className="block">
          <span className={label}>{t('reg.name')}</span>
          <input
            name="name"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>{t('reg.phone')}</span>
          <input
            name="phone"
            type="tel"
            inputMode="numeric"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>{t('reg.village')}</span>
          <select
            name="villageId"
            value={villageId}
            onChange={(e) => set({ villageId: e.target.value })}
            className={`${field} bg-white`}
          >
            {mine.length !== 1 && <option value="">—</option>}
            {mine.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.district})
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className={label}>{t('wizard.sex')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {SEXES.map((s) => (
              <Button
                key={s}
                variant={form.sex === s ? 'primary' : 'secondary'}
                aria-pressed={form.sex === s}
                onClick={() => set({ sex: s })}
                data-testid={`reg-sex-${s}`}
              >
                {t(`sex.${s}`)}
              </Button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className={label}>{t('reg.dob')}</span>
          <input
            name="dateOfBirth"
            type="date"
            max={today()}
            value={form.dateOfBirth}
            onChange={(e) => set({ dateOfBirth: e.target.value })}
            className={field}
          />
        </label>
        <label className="flex min-h-12 items-start gap-3 rounded-xl bg-slate-50 p-3">
          <input
            type="checkbox"
            name="createLogin"
            checked={form.createLogin}
            onChange={(e) => set({ createLogin: e.target.checked })}
            className="mt-1 h-6 w-6"
          />
          <span>
            <span className="block font-medium">{t('reg.createLogin')}</span>
            <span className="block text-sm text-slate-600">{t('reg.createLoginHint')}</span>
          </span>
        </label>
        {form.createLogin && (
          <label className="block">
            <span className={label}>{t('reg.language')}</span>
            <select
              name="preferredLanguage"
              value={form.preferredLanguage}
              onChange={(e) => set({ preferredLanguage: e.target.value as (typeof LOCALES)[number] })}
              className={`${field} bg-white`}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        {duplicate && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void submit(undefined, true)}
            data-testid="register-anyway"
          >
            {t('reg.registerAnyway')}
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => navigate('/hw')}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" className="flex-1" disabled={busy} data-testid="register-submit">
            {t('reg.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
