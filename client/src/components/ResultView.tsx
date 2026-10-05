import { getTriageLevel, type TriageLevelId } from '@ruralcare/shared';
import { useI18n } from '../i18n/I18nProvider';
import { EMERGENCY_TEL } from '../lib/config';
import type { GuidanceView, ResultSource } from '../lib/db';
import { LevelBadge } from './ui';

export interface ResultViewProps {
  level: TriageLevelId;
  guidance: GuidanceView;
  source: ResultSource;
  syncStatus?: 'synced' | 'pending' | 'rejected';
}

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
        className="rounded-2xl p-5 text-white shadow"
        style={{ backgroundColor: info.color }}
      >
        <h1 className="text-2xl leading-tight font-bold">{loc(guidance.title)}</h1>
        <p className="mt-2 text-lg">{loc(guidance.advice)}</p>
        {emergency && (
          <a
            href={EMERGENCY_TEL}
            data-testid="call-108"
            className="mt-4 flex min-h-16 items-center justify-center gap-2 rounded-xl bg-white text-2xl font-extrabold text-red-700 shadow-lg"
          >
            📞 {t('result.call')}
          </a>
        )}
      </section>

      {guidance.notice && (
        <p role="note" className="rounded-xl bg-amber-50 p-3 text-amber-900">
          {loc(guidance.notice)}
        </p>
      )}

      {guidance.reasons.length > 0 && (
        <section className="rounded-2xl bg-white p-4">
          <h2 className="font-semibold">{t('result.reasons')}</h2>
          <ul className="mt-2 list-disc pl-5">
            {guidance.reasons.map((r, i) => (
              <li key={i}>{loc(r)}</li>
            ))}
          </ul>
        </section>
      )}

      {guidance.possibleConditions.length > 0 && (
        <section className="rounded-2xl bg-white p-4" data-testid="possible-conditions">
          <h2 className="font-semibold">{t('result.possible')}</h2>
          <ul className="mt-3 space-y-3">
            {guidance.possibleConditions.map((c) => (
              <li key={c.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{loc(c.name)}</span>
                  <span className="text-sm text-slate-600">{Math.round(c.probability * 100)}%</span>
                </div>
                <div className="mt-1 h-2 rounded bg-slate-100" aria-hidden>
                  <div
                    className="h-2 rounded bg-teal-600"
                    style={{ width: `${Math.round(c.probability * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-sm text-slate-700">{loc(c.advice)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p
        className="flex flex-wrap items-center gap-2 text-sm text-slate-700"
        data-testid="result-source"
        data-source={source}
      >
        <span className="font-semibold">{t('result.source')}:</span> {t(`source.${source}`)}
        <LevelBadge level={level} small />
      </p>

      {syncStatus === 'pending' && (
        <p className="rounded-xl bg-sky-50 p-3 text-sky-900" data-testid="pending-note">
          ⏳ {t('result.pending')}
        </p>
      )}
      {syncStatus === 'synced' && <p className="text-sm text-slate-600">✓ {t('result.synced')}</p>}

      <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700" data-testid="disclaimer">
        ⚠️ {loc(guidance.disclaimer)}
      </p>
    </div>
  );
}
