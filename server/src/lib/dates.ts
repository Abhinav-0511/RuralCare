/** Whole months between date of birth and `at`. */
export function ageInMonths(dateOfBirth: Date, at: Date = new Date()): number {
  let months =
    (at.getUTCFullYear() - dateOfBirth.getUTCFullYear()) * 12 +
    (at.getUTCMonth() - dateOfBirth.getUTCMonth());
  if (at.getUTCDate() < dateOfBirth.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

// India has a fixed UTC+05:30 offset (no DST), so day/week buckets can be computed arithmetically.
export const IST_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of `d` in IST. */
export const istDateKey = (d: Date): string =>
  new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Start (as a UTC instant) of the IST day or Monday-based IST week containing `d`. */
export function istBucketStart(d: Date, interval: 'day' | 'week'): Date {
  const local = new Date(d.getTime() + IST_OFFSET_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const daysBack = interval === 'week' ? (local.getUTCDay() + 6) % 7 : 0;
  return new Date(midnightLocal - daysBack * DAY_MS - IST_OFFSET_MS);
}

/** Bucket keys (YYYY-MM-DD of each bucket start, IST) covering [from, to). */
export function istBucketKeys(from: Date, to: Date, interval: 'day' | 'week'): string[] {
  const step = interval === 'week' ? 7 * DAY_MS : DAY_MS;
  const keys: string[] = [];
  for (let t = istBucketStart(from, interval).getTime(); t < to.getTime(); t += step) {
    keys.push(istDateKey(new Date(t)));
  }
  return keys;
}
