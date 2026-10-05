import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: the password is read out or copied by hand from the health worker's screen.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** A one-time password shown once to the health worker or admin; must be changed at first login. */
export function generateTemporaryPassword(length = 10): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** 6-digit numeric OTP. */
export const generateOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
