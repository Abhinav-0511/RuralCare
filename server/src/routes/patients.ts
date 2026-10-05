import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { HydratedDocument } from 'mongoose';
import type { Env } from '../config/env';
import { ageInMonths } from '../lib/dates';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError';
import { generateTemporaryPassword } from '../lib/passwords';
import { currentUser, requireRole } from '../middleware/auth';
import { Patient, type PatientFields } from '../models/patient';
import { User } from '../models/user';
import { Village } from '../models/village';
import { CreatePatientBodySchema, IdParamsSchema, ListPatientsQuerySchema } from '../schemas/api';
import { assertVillageAccess, canAccessPatient, patientScope } from '../services/access';

export const patientToJson = (p: HydratedDocument<PatientFields>) => ({
  ...p.toJSON(),
  ageMonths: ageInMonths(p.dateOfBirth),
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function patientsRouter(deps: { env: Pick<Env, 'BCRYPT_ROUNDS'> }) {
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

  /**
   * Health workers register patients (only in their own villages). This is the only way a patient
   * account comes into existence: with `createLogin` the patient also gets a login with a
   * temporary password, shown once, that must be changed at first login.
   */
  r.post('/', requireRole('health_worker', 'admin'), async (req, res) => {
    const user = currentUser(req);
    const { createLogin, allowDuplicatePhone, preferredLanguage, ...fields } = CreatePatientBodySchema.parse(
      req.body,
    );
    assertVillageAccess(user, fields.villageId);
    if (!(await Village.exists({ _id: fields.villageId })))
      throw badRequest('UNKNOWN_VILLAGE', 'Village not found');
    if (fields.phone) {
      if (createLogin && (await User.exists({ phone: fields.phone }))) {
        throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');
      }
      if (!allowDuplicatePhone && (await Patient.exists({ phone: fields.phone }))) {
        throw conflict(
          'DUPLICATE_PHONE',
          'A patient with this phone number is already registered. Check it is not the same person.',
        );
      }
    }

    const patient = await Patient.create({
      ...fields,
      dateOfBirth: new Date(fields.dateOfBirth),
      registeredBy: user.id,
    });
    if (!createLogin) {
      res.status(201).json(patientToJson(patient));
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    try {
      const login = await User.create({
        name: patient.name,
        phone: fields.phone,
        passwordHash: await bcrypt.hash(temporaryPassword, deps.env.BCRYPT_ROUNDS),
        role: 'patient', // fixed: nothing in the request can choose the role
        patientId: patient._id,
        mustChangePassword: true,
        ...(preferredLanguage ? { preferredLanguage } : {}),
      });
      patient.userId = login._id;
      await patient.save();
    } catch (err) {
      await Patient.deleteOne({ _id: patient._id }); // e.g. the phone was taken in a race
      if ((err as { code?: number }).code === 11000) {
        throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');
      }
      throw err;
    }
    res.status(201).json({ ...patientToJson(patient), login: { phone: fields.phone!, temporaryPassword } });
  });

  /** New temporary password for a patient's login (e.g. no phone for an OTP). Signs out all devices. */
  r.post('/:id/reset-password', requireRole('health_worker', 'admin'), async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const patient = await Patient.findById(id);
    if (!patient) throw notFound('Patient');
    if (!canAccessPatient(currentUser(req), patient)) throw forbidden();
    const login = patient.userId ? await User.findById(patient.userId) : null;
    if (!login || login.role !== 'patient') throw badRequest('NO_LOGIN', 'This patient has no login');

    const temporaryPassword = generateTemporaryPassword();
    login.passwordHash = await bcrypt.hash(temporaryPassword, deps.env.BCRYPT_ROUNDS);
    login.mustChangePassword = true;
    login.tokenVersion += 1;
    await login.save();
    res.json({ phone: login.phone, temporaryPassword });
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
