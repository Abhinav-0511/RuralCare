import { Router } from 'express';
import type { HydratedDocument } from 'mongoose';
import { ageInMonths } from '../lib/dates';
import { badRequest, forbidden, notFound } from '../lib/httpError';
import { currentUser, requireRole } from '../middleware/auth';
import { Patient, type PatientFields } from '../models/patient';
import { Village } from '../models/village';
import { CreatePatientBodySchema, IdParamsSchema, ListPatientsQuerySchema } from '../schemas/api';
import { assertVillageAccess, canAccessPatient, patientScope } from '../services/access';

export const patientToJson = (p: HydratedDocument<PatientFields>) => ({
  ...p.toJSON(),
  ageMonths: ageInMonths(p.dateOfBirth),
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function patientsRouter() {
  const r = Router();

  r.get('/', requireRole('health_worker', 'doctor', 'admin'), async (req, res) => {
    const user = currentUser(req);
    const q = ListPatientsQuerySchema.parse(req.query);
    if (q.villageId) assertVillageAccess(user, q.villageId);
    const filter = {
      ...patientScope(user),
      ...(q.villageId ? { villageId: q.villageId } : {}),
      ...(q.q ? { name: { $regex: escapeRegex(q.q), $options: 'i' } } : {}),
    };
    const [items, total] = await Promise.all([
      Patient.find(filter)
        .sort({ name: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Patient.countDocuments(filter),
    ]);
    res.json({ items: items.map(patientToJson), page: q.page, limit: q.limit, total });
  });

  /** Health workers register patients who have no phone/account of their own. */
  r.post('/', requireRole('health_worker', 'admin'), async (req, res) => {
    const user = currentUser(req);
    const body = CreatePatientBodySchema.parse(req.body);
    assertVillageAccess(user, body.villageId);
    if (!(await Village.exists({ _id: body.villageId })))
      throw badRequest('UNKNOWN_VILLAGE', 'Village not found');

    const patient = await Patient.create({
      ...body,
      dateOfBirth: new Date(body.dateOfBirth),
      registeredBy: user.id,
    });
    res.status(201).json(patientToJson(patient));
  });

  r.get('/:id', async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const patient = await Patient.findById(id);
    if (!patient) throw notFound('Patient');
    if (!canAccessPatient(currentUser(req), patient)) throw forbidden();
    res.json(patientToJson(patient));
  });

  return r;
}
