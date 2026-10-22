import { getTriageLevel, type TriageLevelId } from '@ruralcare/shared';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-800 text-white shadow-sm hover:bg-brand-900 active:bg-brand-950 disabled:bg-stone-300 disabled:text-stone-600 disabled:shadow-none',
  secondary:
    'bg-white text-brand-800 border border-stone-300 hover:border-brand-700 hover:bg-brand-50 disabled:opacity-50',
  danger: 'bg-red-700 text-white shadow-sm hover:bg-red-800',
  ghost: 'text-brand-800 hover:bg-brand-50',
};

/** Large touch target (min 48 px) for cheap phones and gloved/shaky hands. */
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-4 ${className}`}>{children}</section>
  );
}

/** Section heading inside a card, with an optional leading icon. */
export function CardTitle({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-stone-900">
      {icon && <Icon name={icon} className="size-5 text-brand-700" />}
      {children}
    </h2>
  );
}

type Tone = 'info' | 'warning' | 'danger' | 'success' | 'neutral' | 'brand';
const TONES: Record<Tone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  danger: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  neutral: 'border-stone-200 bg-stone-100 text-stone-700',
  brand: 'border-brand-100 bg-brand-50 text-brand-900',
};

/** Inline callout: a tinted box with an icon. Pass role / data-testid through `props`. */
export function Notice({
  tone = 'neutral',
  icon,
  className = '',
  children,
  ...props
}: {
  tone?: Tone;
  icon?: IconName;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLParagraphElement>, 'className' | 'children'>) {
  return (
    <p {...props} className={`flex gap-2.5 rounded-lg border p-3 ${TONES[tone]} ${className}`}>
      {icon && <Icon name={icon} className="mt-0.5 size-[1.125rem]" />}
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

export function LevelBadge({ level, small = false }: { level: TriageLevelId; small?: boolean }) {
  const { loc } = useI18n();
  const info = getTriageLevel(level);
  if (small)
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide whitespace-nowrap"
        style={{ backgroundColor: `${info.color}17`, color: info.color }}
      >
        <span className="size-1.5 rounded-full" style={{ backgroundColor: info.color }} aria-hidden />
        {level.replaceAll('_', ' ')}
      </span>
    );
  return (
    <span
      className="inline-block rounded-md px-3 py-1 text-sm font-semibold text-white"
      style={{ backgroundColor: info.color }}
    >
      {loc(info.title)}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-3 p-6 text-stone-600">
      <span
        className="size-5 animate-spin rounded-full border-2 border-stone-300 border-t-brand-700"
        aria-hidden
      />
      {label ?? '…'}
    </p>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
      <Icon name="alert" className="mt-0.5 size-[1.125rem]" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/** Page heading used by list pages. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-1">
      <h1 className="text-2xl font-bold text-stone-900">{children}</h1>
      {sub && <p className="mt-0.5 text-stone-600">{sub}</p>}
    </div>
  );
}

export const formatDateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale === 'en' ? 'en-IN' : `${locale}-IN`, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
