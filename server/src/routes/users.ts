import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { Env } from '../config/env';
import { badRequest, conflict, notFound } from '../lib/httpError';
import { generateTemporaryPassword } from '../lib/passwords';
import { currentUser, requireRole } from '../middleware/auth';
import { User } from '../models/user';
import { Village } from '../models/village';
import {
  CreateUserBodySchema,
  IdParamsSchema,
  ListUsersQuerySchema,
  UpdateUserBodySchema,
} from '../schemas/api';

/** All villages must exist; newly assigned ones (not in `alreadyAssigned`) must also be active. */
async function assertVillagesExist(ids: string[] | undefined, alreadyAssigned: string[] = []) {
  if (!ids?.length) return;
  const found = await Village.find({ _id: { $in: ids } })
    .select('isActive')
    .lean();
  if (found.length !== new Set(ids).size)
    throw badRequest('UNKNOWN_VILLAGE', 'One or more villages do not exist');
  if (found.some((v) => v.isActive === false && !alreadyAssigned.includes(String(v._id)))) {
    throw badRequest('VILLAGE_INACTIVE', 'This village is deactivated');
  }
}

/** Staff account management. Admin only: the only place where a role can be set. */
export function usersRouter(deps: { env: Pick<Env, 'BCRYPT_ROUNDS'> }) {
  const r = Router();
  r.use(requireRole('admin'));

  r.get('/', async (req, res) => {
    const q = ListUsersQuerySchema.parse(req.query);
    const filter = q.role ? { role: q.role } : {};
    const [items, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      User.countDocuments(filter),
    ]);
    res.json({ items: items.map((u) => u.toJSON()), page: q.page, limit: q.limit, total });
  });

  r.post('/', async (req, res) => {
    const body = CreateUserBodySchema.parse(req.body);
    await assertVillagesExist(body.villageIds);
    if (await User.exists({ phone: body.phone })) {
      throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');
    }
    const { password, ...rest } = body;
    // Without a password, a temporary one is generated, shown once, and must be changed at first login.
    const temporaryPassword = password ? undefined : generateTemporaryPassword();
    const user = await User.create({
      ...rest,
      passwordHash: await bcrypt.hash(password ?? temporaryPassword!, deps.env.BCRYPT_ROUNDS),
      mustChangePassword: !password,
    });
    res.status(201).json({ ...user.toJSON(), ...(temporaryPassword ? { temporaryPassword } : {}) });
  });

  r.patch('/:id', async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const body = UpdateUserBodySchema.parse(req.body);
    if (id === currentUser(req).id && (body.isActive === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('SELF_LOCKOUT', 'You cannot deactivate yourself or remove your own admin role');
    }
    const user = await User.findById(id);
    if (!user) throw notFound('User');
    // An active account may keep a village that was deactivated later, but not gain one,
    // and an account can't be reactivated into a deactivated village.
    const current = user.villageIds.map(String);
    const willBeActive = body.isActive ?? user.isActive;
    if (willBeActive) await assertVillagesExist(body.villageIds ?? current, user.isActive ? current : []);
    else await assertVillagesExist(body.villageIds, current.concat(body.villageIds ?? []));
    if (user.role === 'patient' && body.role) {
      throw badRequest('INVALID_ROLE_CHANGE', 'Patient accounts cannot be converted to staff accounts');
    }
    // Deactivation or a role change revokes existing tokens (they carry the old role).
    const revoke = body.isActive === false || (body.role !== undefined && body.role !== user.role);
    user.set(body);
    if (revoke) user.tokenVersion += 1;
    await user.save();
    res.json(user.toJSON());
  });

  /** New temporary password for a staff account. Signs out all its devices. */
  r.post('/:id/reset-password', async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const user = await User.findById(id);
    if (!user) throw notFound('User');
    if (user.role === 'patient') {
      throw badRequest('USE_PATIENT_RESET', "Reset a patient's password from their patient record");
    }
    const temporaryPassword = generateTemporaryPassword();
    user.passwordHash = await bcrypt.hash(temporaryPassword, deps.env.BCRYPT_ROUNDS);
    user.mustChangePassword = true;
    user.tokenVersion += 1;
    await user.save();
    res.json({ phone: user.phone, temporaryPassword });
  });

  return r;
}
