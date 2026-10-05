import { evaluateVitalAlerts, vitalsConfig } from '@ruralcare/shared';
import { Router } from 'express';
import { ageInMonths } from '../lib/dates';
import { badRequest, forbidden, HttpError, notFound } from '../lib/httpError';
import { currentUser } from '../middleware/auth';
import { Patient } from '../models/patient';
import { IdParamsSchema, LatestVitalsQuerySchema, VitalsQuerySchema } from '../schemas/api';
import { canAccessPatient } from '../services/access';
import { type Bucket, BUCKETS, type VitalsStore } from '../vitals/store';

const HOUR = 3_600_000;
const BUCKET_MS: Record<Bucket, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': HOUR,
  '1d': 24 * HOUR,
};
const MAX_POINTS = 2000;

/** Picks a bucket that gives at most a few hundred points for the range. */
export function autoBucket(rangeMs: number): Bucket {
  if (rangeMs <= 2 * HOUR) return '1m';
  if (rangeMs <= 24 * HOUR) return '15m';
  if (rangeMs <= 7 * 24 * HOUR) return '1h';
  return '1d';
}

export function vitalsRouter(deps: { store: VitalsStore | null }) {
  const r = Router();

  const requireStore = () => {
    if (!deps.store) throw new HttpError(503, 'VITALS_UNAVAILABLE', 'Vitals storage is not configured');
    return deps.store;
  };

  const loadPatient = async (req: Parameters<typeof currentUser>[0]) => {
    const { id } = IdParamsSchema.parse(req.params);
    const patient = await Patient.findById(id);
    if (!patient) throw notFound('Patient');
    if (!canAccessPatient(currentUser(req), patient)) throw forbidden();
    return patient;
  };

  /** time_bucket() averages (plus min SpO2 / max heart rate and temperature per bucket). */
  r.get('/:id', async (req, res) => {
    const patient = await loadPatient(req);
    const store = requireStore();
    const q = VitalsQuerySchema.parse(req.query);
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * HOUR);
    if (from >= to) throw badRequest('INVALID_RANGE', '`from` must be before `to`');
    const bucket = q.bucket ?? autoBucket(to.getTime() - from.getTime());
    if ((to.getTime() - from.getTime()) / BUCKET_MS[bucket] > MAX_POINTS) {
      throw badRequest('TOO_MANY_POINTS', `Use a larger bucket for this range (max ${MAX_POINTS} points)`);
    }
    const points = await store.series(patient.id, from, to, bucket);
    res.json({
      patientId: patient.id,
      from: from.toISOString(),
      to: to.toISOString(),
      bucket,
      bucketInterval: BUCKETS[bucket],
      source: bucket === '1h' || bucket === '1d' ? 'vitals_hourly' : 'vitals',
      points,
    });
  });

  /** Newest value of each vital in the window, and the alerts those values would raise. */
  r.get('/:id/latest', async (req, res) => {
    const patient = await loadPatient(req);
    const store = requireStore();
    const { windowMinutes } = LatestVitalsQuerySchema.parse(req.query);
    const minutes = windowMinutes ?? vitalsConfig.recentWindowMinutes;
    const to = new Date();
    const latest = await store.latest(patient.id, new Date(to.getTime() - minutes * 60_000), to);
    const { measuredAt, ...values } = latest ?? { measuredAt: null };
    res.json({
      patientId: patient.id,
      windowMinutes: minutes,
      measuredAt: measuredAt ? measuredAt.toISOString() : null,
      vitals: latest ? values : null,
      alerts: latest ? evaluateVitalAlerts(values, { ageMonths: ageInMonths(patient.dateOfBirth) }) : [],
    });
  });

  return r;
}
