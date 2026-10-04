import { Router } from 'express';
import { currentUser, requireRole } from '../middleware/auth';
import { StatsQuerySchema } from '../schemas/api';
import { computeStats } from '../services/stats';

export function dashboardRouter() {
  const r = Router();

  r.get('/stats', requireRole('health_worker', 'doctor', 'admin'), async (req, res) => {
    res.json(await computeStats(currentUser(req), StatsQuerySchema.parse(req.query)));
  });

  return r;
}
