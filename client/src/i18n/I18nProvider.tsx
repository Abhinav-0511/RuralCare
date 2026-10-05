import { type Locale, LOCALES, type LocalizedText } from '@ruralcare/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type StringKey, strings } from './strings';

const KEY = 'ruralcare.locale';

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Picks the current language from a shared LocalizedText. */
  loc: (text: LocalizedText | undefined | null) => string;
}

const I18nContext = createContext<I18n | null>(null);

export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ta: 'தமிழ்', hi: 'हिन्दी' };

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    /* storage blocked */
  }
  const nav = navigator.language.slice(0, 2);
  return (LOCALES as readonly string[]).includes(nav) ? (nav as Locale) : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) =>
        Object.entries(vars ?? {}).reduce(
          (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
          strings[key][locale],
        ),
      loc: (text) => (text ? (text[locale] ?? text.en) : ''),
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** Language switch shown on every screen. */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t('nav.language')}
      className="flex overflow-hidden rounded-lg border border-white/40"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`min-h-10 px-2.5 text-sm ${locale === l ? 'bg-white font-semibold text-teal-800' : 'text-white'}`}
        >
          {LOCALE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
