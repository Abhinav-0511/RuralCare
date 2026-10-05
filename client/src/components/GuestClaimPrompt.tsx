import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { db } from '../lib/db';
import { useLiveQuery } from '../lib/hooks';
import { claimGuestChecks, guestPromptAnswered, markGuestPromptAnswered } from '../triage/guest';
import { Button, Card, LevelBadge, formatDateTime } from './ui';

/**
 * Shown once to a patient who logs in on a phone that has guest checks on it: "You have N
 * earlier checks on this phone. Add them to your record?" The checks are listed so the patient
 * can see whether they were about them (a family phone may be shared).
 */
export function GuestClaimPrompt() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const online = useOnline();
  const checks = useLiveQuery(() => db.guestChecks.orderBy('createdAt').toArray(), [], []);
  const [answered, setAnswered] = useState(() => (user ? guestPromptAnswered(user.id) : true));
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed' | { added: number }>('idle');

  if (!user?.patientId || user.mustChangePassword) return null;
  if (typeof status === 'object') {
    return (
      <p
        role="status"
        data-testid="claim-done"
        className="mb-4 rounded-xl bg-emerald-50 p-3 text-emerald-900"
      >
        ✓ {t('claim.done', { n: status.added })}
      </p>
    );
  }
  if (answered || checks.length === 0 || !online) return null;

  const add = async () => {
    setStatus('busy');
    try {
      const { added, total } = await claimGuestChecks({ patientId: user.patientId!, patientName: user.name });
      if (added === total) markGuestPromptAnswered(user.id, 'added');
      setStatus({ added });
    } catch {
      setStatus('failed');
    }
  };
  const decline = () => {
    markGuestPromptAnswered(user.id, 'declined');
    setAnswered(true);
  };

  return (
    <Card className="mb-4 border-2 border-teal-700">
      <section data-testid="claim-prompt" data-count={checks.length} className="space-y-3">
        <p className="text-lg font-semibold">{t('claim.question', { n: checks.length })}</p>
        <p className="text-sm text-slate-600">{t('claim.hint')}</p>
        <ul className="space-y-1">
          {checks.map((c) => (
            <li key={c.clientId} className="flex items-center justify-between gap-2 text-sm">
              {formatDateTime(c.createdAt, locale)} <LevelBadge level={c.level} small />
            </li>
          ))}
        </ul>
        {status === 'failed' && (
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">
            {t('claim.failed')}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => void add()}
            disabled={status === 'busy'}
            data-testid="claim-yes"
          >
            {t('claim.yes')}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={decline} data-testid="claim-no">
            {t('claim.no')}
          </Button>
        </div>
      </section>
    </Card>
  );
}
