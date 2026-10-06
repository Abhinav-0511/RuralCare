import { LOCALES } from '@ruralcare/shared';
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
import {
  CreatePatientBodySchema,
  CreatePatientLoginBodySchema,
  IdParamsSchema,
  ListPatientsQuerySchema,
} from '../schemas/api';
import { assertVillageAccess, canAccessPatient, patientScope } from '../services/access';

export const patientToJson = (p: HydratedDocument<PatientFields>) => ({
  ...p.toJSON(),
  ageMonths: ageInMonths(p.dateOfBirth),
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function patientsRouter(deps: { env: Pick<Env, 'BCRYPT_ROUNDS'> }) {
  const r = Router();

  /** Creates the patient's login (role fixed to patient) with a temporary password; returns it once. */
  async function issueLogin(
    patient: HydratedDocument<PatientFields>,
    phone: string,
    preferredLanguage?: (typeof LOCALES)[number],
  ) {
    const temporaryPassword = generateTemporaryPassword();
    try {
      const login = await User.create({
        name: patient.name,
        phone,
        passwordHash: await bcrypt.hash(temporaryPassword, deps.env.BCRYPT_ROUNDS),
        role: 'patient', // fixed: nothing in the request can choose the role
        patientId: patient._id,
        mustChangePassword: true,
        ...(preferredLanguage ? { preferredLanguage } : {}),
      });
      patient.userId = login._id;
      await patient.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');
      }
      throw err;
    }
    return { phone, temporaryPassword };
  }

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
    const village = await Village.findById(fields.villageId).select('isActive').lean();
    if (!village) throw badRequest('UNKNOWN_VILLAGE', 'Village not found');
    if (village.isActive === false) throw badRequest('VILLAGE_INACTIVE', 'This village is deactivated');
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

    try {
      const login = await issueLogin(patient, fields.phone!, preferredLanguage);
      res.status(201).json({ ...patientToJson(patient), login });
    } catch (err) {
      await Patient.deleteOne({ _id: patient._id }); // e.g. the phone was taken in a race
      throw err;
    }
  });

  /**
   * Login for a patient registered earlier without one (own villages only). Same temporary-password
   * flow as registration. Uses the record's phone, or `phone` if the record has none yet.
   */
  r.post('/:id/login', requireRole('health_worker', 'admin'), async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const body = CreatePatientLoginBodySchema.parse(req.body ?? {});
    const patient = await Patient.findById(id);
    if (!patient) throw notFound('Patient');
    if (!canAccessPatient(currentUser(req), patient)) throw forbidden();
    if (patient.userId && (await User.exists({ _id: patient.userId }))) {
      throw conflict('LOGIN_EXISTS', 'This patient already has a login; reset its password instead');
    }
    if (patient.phone && body.phone && body.phone !== patient.phone) {
      throw badRequest('PHONE_MISMATCH', "Use the phone number on the patient's record");
    }
    const phone = patient.phone ?? body.phone;
    if (!phone) throw badRequest('PHONE_REQUIRED', 'A mobile number is needed for a login');
    if (await User.exists({ phone })) {
      throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');
    }

    const hadPhone = Boolean(patient.phone);
    if (!hadPhone) patient.phone = phone;
    try {
      res.status(201).json(await issueLogin(patient, phone, body.preferredLanguage));
    } catch (err) {
      if (!hadPhone) await Patient.updateOne({ _id: patient._id }, { $unset: { phone: '' } });
      throw err;
    }
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
