import { Types } from 'mongoose';
import { forbidden } from '../lib/httpError';
import type { AuthUser } from '../middleware/auth';

// Who can see what:
//   admin, doctor   -> everything
//   health_worker   -> patients and sessions in their assigned villages
//   patient         -> only their own patient record and sessions

const oid = (id: string) => new Types.ObjectId(id);

/** Mongo filter limiting triage sessions to the caller's scope. ObjectIds, so it also works in $match. */
export function sessionScope(user: AuthUser): Record<string, unknown> {
  switch (user.role) {
    case 'admin':
    case 'doctor':
      return {};
    case 'health_worker':
      return { villageId: { $in: user.villageIds.map(oid) } };
    case 'patient':
      // A patient account without a linked record sees nothing.
      return { patientId: user.patientId ? oid(user.patientId) : null };
  }
}

/** Mongo filter limiting patients to the caller's scope. */
export function patientScope(user: AuthUser): Record<string, unknown> {
  switch (user.role) {
    case 'admin':
    case 'doctor':
      return {};
    case 'health_worker':
      return { villageId: { $in: user.villageIds.map(oid) } };
    case 'patient':
      return { _id: user.patientId ? oid(user.patientId) : null };
  }
}

export function canAccessPatient(user: AuthUser, patient: { _id: unknown; villageId: unknown }): boolean {
  switch (user.role) {
    case 'admin':
    case 'doctor':
      return true;
    case 'health_worker':
      return user.villageIds.includes(String(patient.villageId));
    case 'patient':
      return user.patientId !== null && user.patientId === String(patient._id);
  }
}

export function assertVillageAccess(user: AuthUser, villageId: string): void {
  if (user.role === 'health_worker' && !user.villageIds.includes(villageId)) {
    throw forbidden('You are not assigned to this village');
  }
  if (user.role === 'patient') throw forbidden();
}
