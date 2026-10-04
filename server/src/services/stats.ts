import { TRIAGE_LEVELS, type TriageLevelId } from '@ruralcare/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { IST_TIMEZONE, istBucketKeys } from '../lib/dates';
import { badRequest } from '../lib/httpError';
import type { AuthUser } from '../middleware/auth';
import { TriageSession } from '../models/triageSession';
import { Village } from '../models/village';
import type { StatsQuerySchema, StatsResponseSchema } from '../schemas/api';
import { assertVillageAccess, sessionScope } from './access';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

type LevelCounts = Record<TriageLevelId, number>;
const emptyCounts = (): LevelCounts => Object.fromEntries(TRIAGE_LEVELS.map((l) => [l, 0])) as LevelCounts;

interface FacetResult {
  byLevel: { _id: TriageLevelId; n: number }[];
  byVillage: { _id: { v: Types.ObjectId; l: TriageLevelId }; n: number }[];
  overTime: { _id: { d: string; l: TriageLevelId }; n: number }[];
  pendingReview: { n: number }[];
  modelUnavailable: { n: number }[];
}

export async function computeStats(
  user: AuthUser,
  query: z.output<typeof StatsQuerySchema>,
): Promise<z.input<typeof StatsResponseSchema>> {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY_MS);
  if (from >= to) throw badRequest('INVALID_RANGE', '`from` must be before `to`');
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw badRequest('RANGE_TOO_LARGE', `Range cannot exceed ${MAX_RANGE_DAYS} days`);
  }
  if (query.villageId) assertVillageAccess(user, query.villageId);

  const match = {
    ...sessionScope(user),
    ...(query.villageId ? { villageId: new Types.ObjectId(query.villageId) } : {}),
    occurredAt: { $gte: from, $lt: to },
  };
  const bucketDate = {
    $dateToString: {
      format: '%Y-%m-%d',
      timezone: IST_TIMEZONE,
      date: {
        $dateTrunc: {
          date: '$occurredAt',
          unit: query.interval,
          timezone: IST_TIMEZONE,
          startOfWeek: 'monday',
        },
      },
    },
  };

  const [facets] = await TriageSession.aggregate<FacetResult>([
    { $match: match },
    {
      $facet: {
        byLevel: [{ $group: { _id: '$result.level', n: { $sum: 1 } } }],
        byVillage: [{ $group: { _id: { v: '$villageId', l: '$result.level' }, n: { $sum: 1 } } }],
        overTime: [{ $group: { _id: { d: bucketDate, l: '$result.level' }, n: { $sum: 1 } } }],
        pendingReview: [{ $match: { 'review.status': 'pending' } }, { $count: 'n' }],
        modelUnavailable: [{ $match: { 'result.source': 'rule_engine_fallback' } }, { $count: 'n' }],
      },
    },
  ]);
  if (!facets) throw new Error('Aggregation returned no result');

  const byLevel = emptyCounts();
  for (const row of facets.byLevel) byLevel[row._id] = row.n;

  // Every village in scope is listed (zero-filled) so dashboards show quiet villages too.
  const villageFilter = query.villageId
    ? { _id: query.villageId }
    : user.role === 'health_worker'
      ? { _id: { $in: user.villageIds } }
      : {};
  const villages = await Village.find(villageFilter).sort({ name: 1 }).lean();
  const byVillage = new Map(
    villages.map((v) => [
      String(v._id),
      { villageId: String(v._id), villageName: v.name, total: 0, byLevel: emptyCounts() },
    ]),
  );
  for (const row of facets.byVillage) {
    const entry = byVillage.get(String(row._id.v));
    if (!entry) continue;
    entry.byLevel[row._id.l] += row.n;
    entry.total += row.n;
  }

  const overTime = new Map(
    istBucketKeys(from, to, query.interval).map((date) => [date, { date, total: 0, byLevel: emptyCounts() }]),
  );
  for (const row of facets.overTime) {
    const bucket = overTime.get(row._id.d);
    if (!bucket) continue;
    bucket.byLevel[row._id.l] += row.n;
    bucket.total += row.n;
  }

  return {
    range: { from: from.toISOString(), to: to.toISOString(), interval: query.interval },
    total: Object.values(byLevel).reduce((a, b) => a + b, 0),
    pendingReview: facets.pendingReview[0]?.n ?? 0,
    modelUnavailable: facets.modelUnavailable[0]?.n ?? 0,
    byLevel,
    byVillage: [...byVillage.values()],
    overTime: [...overTime.values()],
  };
}
