import { Router } from 'express';
import type { TokenService } from '../lib/tokens';
import { authenticate, requireRole } from '../middleware/auth';
import { HttpError, notFound } from '../lib/httpError';
import { User } from '../models/user';
import { Village } from '../models/village';
import {
  CreateVillageBodySchema,
  IdParamsSchema,
  ListVillagesQuerySchema,
  UpdateVillageBodySchema,
} from '../schemas/api';

export function villagesRouter(deps: { tokens: TokenService }) {
  const r = Router();

  /** Public. Every village, with `isActive`; `?active=true` lists only the ones open for registration. */
  r.get('/', async (req, res) => {
    const q = ListVillagesQuerySchema.parse(req.query);
    const villages = await Village.find(q.active ? { isActive: { $ne: false } } : {}).sort({
      district: 1,
      name: 1,
    });
    res.json(villages.map((v) => v.toJSON()));
  });

  r.post('/', authenticate(deps.tokens), requireRole('admin'), async (req, res) => {
    const village = await Village.create(CreateVillageBodySchema.parse(req.body));
    res.status(201).json(village.toJSON());
  });

  r.patch('/:id', authenticate(deps.tokens), requireRole('admin'), async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const body = UpdateVillageBodySchema.parse(req.body);
    if (body.isActive === false) {
      // Deactivating must not leave active staff assigned to a village nobody can register in.
      const staff = await User.find({ villageIds: id, isActive: true, role: { $ne: 'patient' } })
        .select('name')
        .lean();
      if (staff.length) {
        throw new HttpError(
          409,
          'VILLAGE_HAS_STAFF',
          `Move or deactivate the staff assigned to this village first: ${staff.map((s) => s.name).join(', ')}`,
          { staff: staff.map((s) => ({ id: String(s._id), name: s.name })) },
        );
      }
    }
    const village = await Village.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    });
    if (!village) throw notFound('Village');
    res.json(village.toJSON());
  });

  return r;
}
