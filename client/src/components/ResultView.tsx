import { getTriageLevel, type TriageLevelId } from '@ruralcare/shared';
import { useI18n } from '../i18n/I18nProvider';
import { EMERGENCY_TEL } from '../lib/config';
import type { GuidanceView, ResultSource } from '../lib/db';
import { Icon, type IconName } from './Icon';
import { LevelBadge, Notice } from './ui';

export interface ResultViewProps {
  level: TriageLevelId;
  guidance: GuidanceView;
  source: ResultSource;
  syncStatus?: 'synced' | 'pending' | 'rejected';
}

const LEVEL_ICON: Record<TriageLevelId, IconName> = {
  EMERGENCY: 'alert',
  SEE_DOCTOR_24H: 'clock',
  SEE_DOCTOR_SOON: 'calendar',
  SELF_CARE: 'home',
};

/** Colour-coded result with reasons, possible conditions, advice, disclaimer and (EMERGENCY) Call 108. */
export function ResultView({ level, guidance, source, syncStatus }: ResultViewProps) {
  const { t, loc } = useI18n();
  const info = getTriageLevel(level);
  const emergency = level === 'EMERGENCY';

  return (
    <div className="space-y-4">
      <section
        aria-live="polite"
        data-testid="result-level"
        data-level={level}
        className="relative overflow-hidden rounded-xl p-5 text-white"
        style={{ backgroundColor: info.color }}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15">
            <Icon name={LEVEL_ICON[level]} className="size-6" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-bold">{loc(guidance.title)}</h1>
            <p className="mt-2 text-lg leading-snug text-white/95">{loc(guidance.advice)}</p>
          </div>
        </div>
        {emergency && (
          <a
            href={EMERGENCY_TEL}
            data-testid="call-108"
            className="mt-5 flex min-h-16 items-center justify-center gap-3 rounded-lg bg-white text-2xl font-extrabold text-red-700 shadow-lg active:bg-red-50"
          >
            <Icon name="phone" className="size-7" strokeWidth={2.2} />
            {t('result.call')}
          </a>
        )}
      </section>

      {guidance.notice && (
        <Notice tone="warning" icon="info" role="note">
          {loc(guidance.notice)}
        </Notice>
      )}

      {guidance.reasons.length > 0 && (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-semibold">{t('result.reasons')}</h2>
          <ul className="mt-2 space-y-1.5">
            {guidance.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className="mt-2 size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: info.color }}
                  aria-hidden
                />
                <span>{loc(r)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {guidance.possibleConditions.length > 0 && (
        <section
          className="rounded-xl border border-stone-200 bg-white p-4"
          data-testid="possible-conditions"
        >
          <h2 className="font-semibold">{t('result.possible')}</h2>
          <ul className="mt-3 divide-y divide-stone-100">
            {guidance.possibleConditions.map((c) => (
              <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{loc(c.name)}</span>
                  <span className="text-sm text-stone-500 tabular-nums">
                    {Math.round(c.probability * 100)}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-stone-100" aria-hidden>
                  <div
                    className="h-1.5 rounded-full bg-brand-600"
                    style={{ width: `${Math.round(c.probability * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-sm text-stone-600">{loc(c.advice)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p
        className="flex flex-wrap items-center gap-2 text-sm text-stone-700"
        data-testid="result-source"
        data-source={source}
      >
        <span className="font-semibold">{t('result.source')}:</span> {t(`source.${source}`)}
        <LevelBadge level={level} small />
      </p>

      {syncStatus === 'pending' && (
        <Notice tone="info" icon="clock" data-testid="pending-note">
          {t('result.pending')}
        </Notice>
      )}
      {syncStatus === 'synced' && (
        <p className="flex items-center gap-1.5 text-sm text-stone-600">
          <Icon name="check" className="size-4 text-emerald-700" strokeWidth={2.2} />
          {t('result.synced')}
        </p>
      )}

      <Notice tone="neutral" icon="info" className="text-sm" data-testid="disclaimer">
        {loc(guidance.disclaimer)}
      </Notice>
    </div>
  );
}
