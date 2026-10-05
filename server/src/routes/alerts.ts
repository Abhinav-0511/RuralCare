import { vitalsConfig } from '@ruralcare/shared';
import { Router } from 'express';
import { Types } from 'mongoose';
import { conflict, forbidden, notFound } from '../lib/httpError';
import { type AuthUser, currentUser, requireRole } from '../middleware/auth';
import { Alert } from '../models/alert';
import { Patient } from '../models/patient';
import { AcknowledgeAlertBodySchema, IdParamsSchema, ListAlertsQuerySchema } from '../schemas/api';
import { assertVillageAccess, canAccessPatient, sessionScope } from '../services/access';

const labels = new Map(vitalsConfig.thresholds.map((t) => [t.code, t.label]));

async function withPatientNames<T extends { patientId: unknown }>(items: T[]) {
  const patients = await Patient.find({ _id: { $in: items.map((a) => a.patientId) } })
    .select('name')
    .lean();
  const names = new Map(patients.map((p) => [String(p._id), p.name]));
  return items.map((a) => ({ ...a, patientName: names.get(String(a.patientId)) ?? null }));
}

const toJson = (doc: InstanceType<typeof Alert>) => ({
  ...(doc.toJSON() as unknown as Record<string, unknown>),
  patientId: doc.patientId,
  label: labels.get(doc.code) ?? null,
});

const canAccessAlert = (user: AuthUser, alert: { patientId: unknown; villageId: unknown }) =>
  canAccessPatient(user, { _id: alert.patientId, villageId: alert.villageId });

/** Same access rules as patients: health workers see their villages, patients only their own. */
export function alertsRouter() {
  const r = Router();

  r.get('/', async (req, res) => {
    const user = currentUser(req);
    const q = ListAlertsQuerySchema.parse(req.query);
    if (q.villageId) assertVillageAccess(user, q.villageId);
    const filter = {
      ...(q.acknowledged !== undefined ? { acknowledged: q.acknowledged === 'true' } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.patientId ? { patientId: new Types.ObjectId(q.patientId) } : {}),
      ...(q.villageId ? { villageId: new Types.ObjectId(q.villageId) } : {}),
    };
    const scoped = { $and: [sessionScope(user), filter] };
    const [docs, total] = await Promise.all([
      Alert.find(scoped)
        .sort({ acknowledged: 1, severity: 1, lastSeenAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Alert.countDocuments(scoped),
    ]);
    res.json({ items: await withPatientNames(docs.map(toJson)), page: q.page, limit: q.limit, total });
  });

  r.patch('/:id', requireRole('health_worker', 'doctor'), async (req, res) => {
    const user = currentUser(req);
    const { id } = IdParamsSchema.parse(req.params);
    const { note } = AcknowledgeAlertBodySchema.parse(req.body);

    const existing = await Alert.findById(id);
    if (!existing) throw notFound('Alert');
    if (!canAccessAlert(user, existing)) throw forbidden();

    // Conditional update: two people acknowledging at once can't both "win".
    const alert = await Alert.findOneAndUpdate(
      { _id: id, acknowledged: false },
      {
        $set: {
          acknowledged: true,
          acknowledgedBy: new Types.ObjectId(user.id),
          acknowledgedAt: new Date(),
          ...(note ? { acknowledgeNote: note } : {}),
        },
      },
      { new: true },
    );
    if (!alert) throw conflict('ALREADY_ACKNOWLEDGED', 'Alert is already acknowledged');
    const [item] = await withPatientNames([toJson(alert)]);
    res.json(item);
  });

  return r;
}
