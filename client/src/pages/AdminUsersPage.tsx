import { type FormEvent, useState } from 'react';
import { TempPasswordCard } from '../components/TempPasswordCard';
import { Button, Card, ErrorBox, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/strings';
import { api, ApiError, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { useApi } from '../lib/hooks';

interface Village {
  id: string;
  name: string;
  district: string;
  /** Missing on villages created before deactivation existed: active. */
  isActive?: boolean;
}
type StaffRole = 'health_worker' | 'doctor' | 'admin';
const STAFF_ROLES: StaffRole[] = ['health_worker', 'doctor', 'admin'];
const roleKey = (r: StaffRole) => `role.${r}` as StringKey;

const field = 'min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg';
const label = 'mb-1 block font-medium';

function VillagePicker(props: { villages: Village[]; value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend className={label}>{t('admin.assignVillages')}</legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {props.villages
          .filter((v) => v.isActive !== false || props.value.includes(v.id))
          .map((v) => (
            <label key={v.id} className="flex min-h-12 items-center gap-3 rounded-lg px-1">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={props.value.includes(v.id)}
                onChange={(e) =>
                  props.onChange(
                    e.target.checked ? [...props.value, v.id] : props.value.filter((x) => x !== v.id),
                  )
                }
              />
              {v.name} <span className="text-sm text-slate-600">({v.district})</span>
            </label>
          ))}
      </div>
    </fieldset>
  );
}

function errorText(err: unknown, t: (k: StringKey) => string) {
  if (err instanceof ApiError && err.code === 'PHONE_TAKEN') return t('reg.phoneTaken');
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') return t('common.phoneInvalid');
  return err instanceof ApiError ? err.message : t('common.needsInternet');
}

function StaffForm(props: {
  villages: Village[];
  initial?: User;
  onSaved: (result: { user: User; temporaryPassword?: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const editing = Boolean(props.initial);
  const [name, setName] = useState(props.initial?.name ?? '');
  const [phone, setPhone] = useState(props.initial?.phone ?? '');
  const [role, setRole] = useState<StaffRole>((props.initial?.role as StaffRole) ?? 'health_worker');
  const [villageIds, setVillageIds] = useState<string[]>(props.initial?.villageIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ids = role === 'health_worker' ? villageIds : [];
      const res = editing
        ? await api<User>(`/api/users/${props.initial!.id}`, {
            method: 'PATCH',
            body: { name, role, villageIds: ids },
          })
        : await api<User & { temporaryPassword?: string }>('/api/users', {
            method: 'POST',
            body: { name, phone, role, villageIds: ids },
          });
      const { temporaryPassword, ...user } = res as User & { temporaryPassword?: string };
      props.onSaved({ user, ...(temporaryPassword ? { temporaryPassword } : {}) });
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" data-testid="staff-form">
      <label className="block">
        <span className={label}>{t('reg.name')}</span>
        <input
          name="name"
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </label>
      {!editing && (
        <label className="block">
          <span className={label}>{t('login.phone')}</span>
          <input
            name="phone"
            type="tel"
            inputMode="numeric"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={field}
          />
        </label>
      )}
      <label className="block">
        <span className={label}>{t('admin.role')}</span>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className={`${field} bg-white`}
        >
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(roleKey(r))}
            </option>
          ))}
        </select>
      </label>
      {role === 'health_worker' && (
        <VillagePicker villages={props.villages} value={villageIds} onChange={setVillageIds} />
      )}
      {!editing && <p className="text-sm text-slate-600">{t('admin.passwordHint')}</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="flex-1" disabled={busy} data-testid="staff-save">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function VillagesCard({ villages, reload }: { villages: Village[]; reload: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (v?: Village) => {
    setEditing(v?.id ?? 'new');
    setName(v?.name ?? '');
    setDistrict(v?.district ?? '');
    setError(null);
  };
  const setActive = async (v: Village, isActive: boolean) => {
    setError(null);
    try {
      await api(`/api/villages/${v.id}`, { method: 'PATCH', body: { isActive } });
      reload();
    } catch (err) {
      const staff = (err instanceof ApiError && err.code === 'VILLAGE_HAS_STAFF' && err.details) as
        { staff: { name: string }[] } | false;
      setError(
        staff
          ? t('admin.villageHasStaff', { village: v.name, names: staff.staff.map((x) => x.name).join(', ') })
          : errorText(err, t),
      );
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(editing === 'new' ? '/api/villages' : `/api/villages/${editing}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: { name, district },
      });
      setEditing(null);
      reload();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  const form = (
    <form
      onSubmit={(e) => void save(e)}
      className="space-y-3 rounded-xl bg-slate-50 p-3"
      data-testid="village-form"
    >
      <label className="block">
        <span className={label}>{t('admin.villageName')}</span>
        <input
          name="villageName"
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </label>
      <label className="block">
        <span className={label}>{t('admin.district')}</span>
        <input
          name="district"
          required
          minLength={2}
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className={field}
        />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="flex-1">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );

  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">🏘️ {t('admin.villages')}</h2>
      <ul className="divide-y divide-slate-100" data-testid="villages-list">
        {villages.map((v) =>
          editing === v.id ? (
            <li key={v.id} className="py-2">
              {form}
            </li>
          ) : (
            <li
              key={v.id}
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-1"
              data-testid="village-item"
              data-active={v.isActive !== false}
            >
              <span className={v.isActive === false ? 'text-slate-400' : ''}>
                {v.name} <span className="text-sm text-slate-600">({v.district})</span>
                {v.isActive === false && (
                  <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                    {t('admin.inactive')}
                  </span>
                )}
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" onClick={() => open(v)}>
                  {t('admin.edit')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void setActive(v, v.isActive === false)}
                  data-testid="village-toggle"
                >
                  {v.isActive === false ? t('admin.activate') : t('admin.deactivate')}
                </Button>
              </span>
            </li>
          ),
        )}
      </ul>
      {error && !editing && <ErrorBox>{error}</ErrorBox>}
      <p className="mt-2 text-sm text-slate-600">{t('admin.villageDeactivateHint')}</p>
      {editing === 'new' ? (
        <div className="mt-2">{form}</div>
      ) : (
        <Button variant="secondary" className="mt-2 w-full" onClick={() => open()} data-testid="add-village">
          ➕ {t('admin.addVillage')}
        </Button>
      )}
    </Card>
  );
}

/** Admin: staff accounts (create, edit role and villages, deactivate, reset password) and villages. */
export default function AdminUsersPage() {
  const { t } = useI18n();
  const { user: me } = useAuth();
  const online = useOnline();
  const villages = useApi<Village[]>(online ? '/api/villages' : null);
  const users = useApi<{ items: User[] }>(online ? '/api/users?limit=100' : null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [temp, setTemp] = useState<{ phone: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!online) return <p>{t('common.needsInternet')}</p>;
  if (!villages.data || !users.data) return <Spinner label={t('common.loading')} />;
  const villageName = new Map(villages.data.map((v) => [v.id, v.name]));
  const staff = users.data.items.filter((u) => u.role !== 'patient');

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      users.reload();
    } catch (err) {
      setError(errorText(err, t));
    }
  };
  const toggleActive = (u: User) =>
    act(async () => {
      await api(`/api/users/${u.id}`, { method: 'PATCH', body: { isActive: u.isActive === false } });
    });
  const resetPassword = (u: User) =>
    act(async () => {
      const res = await api<{ phone: string; temporaryPassword: string }>(
        `/api/users/${u.id}/reset-password`,
        {
          method: 'POST',
        },
      );
      setTemp({ phone: res.phone, password: res.temporaryPassword });
    });

  return (
    <div className="space-y-4">
      {temp && <TempPasswordCard phone={temp.phone} password={temp.password} onDone={() => setTemp(null)} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      <Card>
        <h2 className="mb-2 text-lg font-bold">👥 {t('admin.users')}</h2>
        {editing === 'new' ? (
          <StaffForm
            villages={villages.data}
            onCancel={() => setEditing(null)}
            onSaved={({ user, temporaryPassword }) => {
              setEditing(null);
              if (temporaryPassword) setTemp({ phone: user.phone, password: temporaryPassword });
              users.reload();
            }}
          />
        ) : (
          <Button className="mb-3 w-full" onClick={() => setEditing('new')} data-testid="add-staff">
            ➕ {t('admin.addUser')}
          </Button>
        )}
        <ul className="divide-y divide-slate-100" data-testid="staff-list">
          {staff.map((u) => (
            <li key={u.id} className="py-3" data-testid="staff-item">
              {editing === u.id ? (
                <StaffForm
                  villages={villages.data!}
                  initial={u}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    users.reload();
                  }}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span
                      className={`font-semibold ${u.isActive === false ? 'text-slate-400 line-through' : ''}`}
                    >
                      {u.name}
                    </span>
                    <span className="text-sm text-slate-600">
                      {t(roleKey(u.role as StaffRole))} · {u.phone}
                      {u.isActive === false && ` · ${t('admin.inactive')}`}
                    </span>
                  </div>
                  {u.role === 'health_worker' && (
                    <p className="text-sm text-slate-700">
                      {u.villageIds.length
                        ? u.villageIds.map((id) => villageName.get(id) ?? id).join(', ')
                        : t('admin.noVillages')}
                    </p>
                  )}
                  {u.id !== me?.id && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setEditing(u.id)}>
                        {t('admin.edit')}
                      </Button>
                      <Button variant="secondary" onClick={() => void resetPassword(u)}>
                        {t('patient.resetPassword')}
                      </Button>
                      <Button
                        variant={u.isActive === false ? 'secondary' : 'danger'}
                        onClick={() => void toggleActive(u)}
                      >
                        {u.isActive === false ? t('admin.activate') : t('admin.deactivate')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <VillagesCard villages={villages.data} reload={villages.reload} />
    </div>
  );
}
