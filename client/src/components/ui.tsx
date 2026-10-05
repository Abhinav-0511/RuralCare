import { getTriageLevel, type TriageLevelId } from '@ruralcare/shared';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300',
  secondary: 'bg-white text-teal-800 border-2 border-teal-700 hover:bg-teal-50 disabled:opacity-50',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-teal-800 hover:bg-teal-50',
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
      className={`min-h-12 rounded-xl px-4 text-base font-semibold transition-colors ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function LevelBadge({ level, small = false }: { level: TriageLevelId; small?: boolean }) {
  const { loc } = useI18n();
  const info = getTriageLevel(level);
  return (
    <span
      className={`inline-block rounded-full font-semibold text-white ${small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}`}
      style={{ backgroundColor: info.color }}
    >
      {small ? level.replaceAll('_', ' ') : loc(info.title)}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <p role="status" className="p-6 text-center text-slate-600">
      {label ?? '…'}
    </p>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
      {children}
    </p>
  );
}

export const formatDateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale === 'en' ? 'en-IN' : `${locale}-IN`, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
