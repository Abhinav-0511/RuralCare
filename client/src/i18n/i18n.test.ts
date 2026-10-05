import { LOCALES } from '@ruralcare/shared';
import { describe, expect, it } from 'vitest';
import { strings } from './strings';

describe('UI strings', () => {
  it('every key has English, Tamil and Hindi text', () => {
    for (const [key, entry] of Object.entries(strings)) {
      for (const l of LOCALES) expect(entry[l]?.trim().length, `${key}.${l}`).toBeGreaterThan(0);
    }
  });

  it('placeholders are the same in every language', () => {
    for (const [key, entry] of Object.entries(strings)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      for (const l of LOCALES) expect(vars(entry[l]), `${key}.${l}`).toBe(vars(entry.en));
    }
  });

  it('Tamil and Hindi are actually translated (not English copies)', () => {
    const same = Object.entries(strings).filter(([, e]) => e.ta === e.en || e.hi === e.en);
    // Only brand-like strings may be identical.
    expect(same.map(([k]) => k)).toEqual([]);
  });
});
