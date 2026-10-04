import { Router } from 'express';
import type { TokenService } from '../lib/tokens';
import { authenticate, requireRole } from '../middleware/auth';
import { Village } from '../models/village';
import { CreateVillageBodySchema } from '../schemas/api';

export function villagesRouter(deps: { tokens: TokenService }) {
  const r = Router();

  /** Public: the registration form needs the village list before the user has an account. */
  r.get('/', async (_req, res) => {
    const villages = await Village.find().sort({ district: 1, name: 1 });
    res.json(villages.map((v) => v.toJSON()));
  });

  r.post('/', authenticate(deps.tokens), requireRole('admin'), async (req, res) => {
    const village = await Village.create(CreateVillageBodySchema.parse(req.body));
    res.status(201).json(village.toJSON());
  });

  return r;
}
