import bcrypt from 'bcryptjs';
import type { Env } from '../config/env';
import { PhoneSchema } from '../schemas/api';
import { User } from '../models/user';

/** Creates the first admin from SEED_ADMIN_* if no admin exists yet. Returns true if one was created. */
export async function ensureAdmin(env: Env): Promise<boolean> {
  if (!env.SEED_ADMIN_PHONE || !env.SEED_ADMIN_PASSWORD) return false;
  if (await User.exists({ role: 'admin' })) return false;

  const phone = PhoneSchema.parse(env.SEED_ADMIN_PHONE);
  if (await User.exists({ phone })) {
    console.warn(`SEED_ADMIN_PHONE ${phone} belongs to an existing non-admin user; not creating an admin`);
    return false;
  }
  await User.create({
    name: env.SEED_ADMIN_NAME,
    phone,
    passwordHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, env.BCRYPT_ROUNDS),
    role: 'admin',
  });
  console.log(`Created initial admin (${phone})`);
  return true;
}
