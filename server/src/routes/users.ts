import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { Env } from '../config/env';
import { badRequest, conflict, notFound } from '../lib/httpError';
import { currentUser, requireRole } from '../middleware/auth';
import { User } from '../models/user';
import { Village } from '../models/village';
import {
  CreateUserBodySchema,
  IdParamsSchema,
  ListUsersQuerySchema,
  UpdateUserBodySchema,
} from '../schemas/api';

async function assertVillagesExist(ids: string[] | undefined) {
  if (!ids?.length) return;
  const found = await Village.countDocuments({ _id: { $in: ids } });
  if (found !== new Set(ids).size) throw badRequest('UNKNOWN_VILLAGE', 'One or more villages do not exist');
}

/** Staff account management. Admin only. */
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
    const user = await User.create({
      ...rest,
      passwordHash: await bcrypt.hash(password, deps.env.BCRYPT_ROUNDS),
    });
    res.status(201).json(user.toJSON());
  });

  r.patch('/:id', async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const body = UpdateUserBodySchema.parse(req.body);
    if (id === currentUser(req).id && (body.isActive === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('SELF_LOCKOUT', 'You cannot deactivate yourself or remove your own admin role');
    }
    await assertVillagesExist(body.villageIds);

    const user = await User.findById(id);
    if (!user) throw notFound('User');
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

  return r;
}
