// Demo data for development and dashboards. All people and phone numbers are fictional.
// Villages are real places near Chennai (approximate coordinates).
import { randomUUID } from 'node:crypto';
import {
  decideTriage,
  MODEL_UNAVAILABLE_FALLBACK_LEVEL,
  type ModelOutcome,
  type NonEmergencyLevelId,
  redFlagEngine,
  type Sex,
  type TriageContext,
} from '@ruralcare/shared';
import bcrypt from 'bcryptjs';
import type { Types } from 'mongoose';
import { ageInMonths } from '../lib/dates';
import { Patient } from '../models/patient';
import { TriageSession } from '../models/triageSession';
import { User } from '../models/user';
import { Village } from '../models/village';
import { decisionToResult } from './triageService';

export const DEMO_PASSWORD = 'RuralCare@123';

const VILLAGES = [
  { name: 'Kelambakkam', district: 'Chengalpattu', location: { lat: 12.788, lng: 80.219 } },
  { name: 'Thiruporur', district: 'Chengalpattu', location: { lat: 12.726, lng: 80.189 } },
  { name: 'Uthiramerur', district: 'Kancheepuram', location: { lat: 12.615, lng: 79.756 } },
  { name: 'Sriperumbudur', district: 'Kancheepuram', location: { lat: 12.968, lng: 79.942 } },
  { name: 'Ponneri', district: 'Tiruvallur', location: { lat: 13.337, lng: 80.195 } },
  { name: 'Gummidipoondi', district: 'Tiruvallur', location: { lat: 13.408, lng: 80.108 } },
];

const STAFF = [
  { name: 'RuralCare Admin', phone: '9000000001', role: 'admin' },
  { name: 'Dr. Anand Krishnan', phone: '9000000002', role: 'doctor' },
  { name: 'Dr. Fathima Begum', phone: '9000000003', role: 'doctor' },
  { name: 'Valli Subramani', phone: '9000000011', role: 'health_worker', villages: [0, 1] },
  { name: 'Rani Shankar', phone: '9000000012', role: 'health_worker', villages: [2, 3] },
  { name: 'Muthulakshmi Ravi', phone: '9000000013', role: 'health_worker', villages: [4, 5] },
] as const;

interface DemoPatient {
  name: string;
  sex: Sex;
  age: { years?: number; months?: number };
  village: number;
  pregnant?: boolean;
  /** Gets a patient login (phone + DEMO_PASSWORD). */
  login?: string;
}

const PATIENTS: DemoPatient[] = [
  { name: 'Lakshmi Murugan', sex: 'female', age: { years: 34 }, village: 0, login: '9000000021' },
  { name: 'Senthil Kumar', sex: 'male', age: { years: 52 }, village: 0 },
  { name: 'Baby Kavin', sex: 'male', age: { months: 2 }, village: 0 },
  { name: 'Meena Selvam', sex: 'female', age: { years: 26 }, village: 1, pregnant: true },
  { name: 'Arumugam Pillai', sex: 'male', age: { years: 67 }, village: 1 },
  { name: 'Divya Ramesh', sex: 'female', age: { years: 9 }, village: 1 },
  { name: 'Saravanan K', sex: 'male', age: { years: 41 }, village: 2 },
  { name: 'Janaki Ammal', sex: 'female', age: { years: 73 }, village: 2 },
  { name: 'Priya Venkatesan', sex: 'female', age: { years: 19 }, village: 2 },
  { name: 'Karthik Raja', sex: 'male', age: { years: 29 }, village: 3 },
  { name: 'Selvi Ganesan', sex: 'female', age: { years: 45 }, village: 3 },
  { name: 'Baby Nila', sex: 'female', age: { months: 8 }, village: 3 },
  { name: 'Murugesan V', sex: 'male', age: { years: 58 }, village: 4 },
  { name: 'Kalaivani S', sex: 'female', age: { years: 31 }, village: 4, pregnant: true },
  { name: 'Arjun Prakash', sex: 'male', age: { years: 14 }, village: 4 },
  { name: 'Ramya Devi', sex: 'female', age: { years: 24 }, village: 5 },
  { name: 'Palani Samy', sex: 'male', age: { years: 62 }, village: 5 },
  { name: 'Gowri Shankar', sex: 'female', age: { years: 38 }, village: 5 },
];

interface Scenario {
  symptoms: string[];
  /** What the (not yet trained) model is pretended to say. Ignored when a red flag matches. */
  demoLevel: NonEmergencyLevelId;
  fever?: boolean;
  weight: number;
  when?: (p: DemoPatient, ageMonths: number) => boolean;
}

const isInfant = (_p: DemoPatient, m: number) => m < 12;
const notInfant = (_p: DemoPatient, m: number) => m >= 12;

const SCENARIOS: Scenario[] = [
  { symptoms: ['cough', 'runny_nose', 'continuous_sneezing'], demoLevel: 'SELF_CARE', weight: 6 },
  {
    symptoms: ['diarrhoea', 'vomiting', 'dehydration'],
    demoLevel: 'SEE_DOCTOR_24H',
    weight: 3,
    when: notInfant,
  },
  {
    symptoms: ['burning_micturition', 'abdominal_pain'],
    demoLevel: 'SEE_DOCTOR_SOON',
    weight: 2,
    when: notInfant,
  },
  {
    symptoms: ['yellowish_skin', 'dark_urine', 'fatigue', 'loss_of_appetite'],
    demoLevel: 'SEE_DOCTOR_24H',
    weight: 1,
    when: notInfant,
  },
  {
    symptoms: ['high_fever', 'joint_pain', 'headache', 'skin_rash'],
    demoLevel: 'SEE_DOCTOR_24H',
    fever: true,
    weight: 3,
  },
  { symptoms: ['itching', 'skin_rash'], demoLevel: 'SEE_DOCTOR_SOON', weight: 2 },
  { symptoms: ['back_pain', 'muscle_pain'], demoLevel: 'SELF_CARE', weight: 2, when: notInfant },
  {
    symptoms: ['headache', 'fatigue', 'dizziness'],
    demoLevel: 'SEE_DOCTOR_SOON',
    weight: 2,
    when: notInfant,
  },
  { symptoms: ['mild_fever', 'cough', 'throat_irritation'], demoLevel: 'SELF_CARE', fever: true, weight: 3 },
  { symptoms: ['chest_pain', 'sweating'], demoLevel: 'SEE_DOCTOR_24H', weight: 1, when: (_p, m) => m >= 360 },
  { symptoms: ['breathlessness', 'cough'], demoLevel: 'SEE_DOCTOR_24H', weight: 1 },
  {
    symptoms: ['slurred_speech', 'weakness_of_one_body_side'],
    demoLevel: 'SEE_DOCTOR_24H',
    weight: 1,
    when: (_p, m) => m >= 600,
  },
  {
    symptoms: ['vaginal_bleeding', 'abdominal_pain'],
    demoLevel: 'SEE_DOCTOR_24H',
    weight: 2,
    when: (p) => !!p.pregnant,
  },
  { symptoms: ['high_fever'], demoLevel: 'SEE_DOCTOR_24H', fever: true, weight: 4, when: isInfant },
];

const REVIEW_NOTES = [
  'Called the family; advised visit to PHC. Will follow up.',
  'Reviewed symptoms. Agree with triage level.',
  'Advised ORS and rest; health worker to check in after 2 days.',
  'Referred to taluk hospital for further tests.',
];

/** Small deterministic PRNG so the demo data is the same on every run. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedSummary {
  villages: number;
  users: number;
  patients: number;
  sessions: number;
  credentials: { role: string; name: string; phone: string }[];
}

export async function seedDemoData(options: {
  bcryptRounds: number;
  sessionCount?: number;
  now?: Date;
}): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const rand = mulberry32(20261004);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, options.bcryptRounds);

  await Promise.all([
    Village.deleteMany({}),
    User.deleteMany({}),
    Patient.deleteMany({}),
    TriageSession.deleteMany({}),
  ]);

  const villages = await Village.insertMany(VILLAGES);
  const staff = await User.insertMany(
    STAFF.map((s) => ({
      name: s.name,
      phone: s.phone,
      role: s.role,
      passwordHash,
      villageIds: 'villages' in s ? s.villages.map((i) => villages[i]!._id) : [],
    })),
  );
  const healthWorkerFor = (villageId: Types.ObjectId) =>
    staff.find((u) => u.role === 'health_worker' && u.villageIds.some((v) => v.equals(villageId)))!;
  const doctors = staff.filter((u) => u.role === 'doctor');

  const patients = [];
  const credentials: SeedSummary['credentials'] = STAFF.map((s) => ({
    role: s.role,
    name: s.name,
    phone: s.phone,
  }));
  for (const p of PATIENTS) {
    const dob = new Date(now);
    dob.setUTCFullYear(dob.getUTCFullYear() - (p.age.years ?? 0));
    dob.setUTCMonth(dob.getUTCMonth() - (p.age.months ?? 0) - 1); // a little past the birthday
    const village = villages[p.village]!;
    const patient = await Patient.create({
      name: p.name,
      sex: p.sex,
      dateOfBirth: dob,
      villageId: village._id,
      registeredBy: healthWorkerFor(village._id)._id,
      ...(p.login ? { phone: p.login } : {}),
    });
    if (p.login) {
      const user = await User.create({
        name: p.name,
        phone: p.login,
        role: 'patient',
        passwordHash,
        patientId: patient._id,
      });
      patient.userId = user._id;
      await patient.save();
      credentials.push({ role: 'patient', name: p.name, phone: p.login });
    }
    patients.push({ demo: p, doc: patient });
  }

  const sessions = [];
  for (let i = 0; i < (options.sessionCount ?? 80); i++) {
    const { demo, doc } = pick(patients);
    const occurredAt = new Date(now.getTime() - rand() * 30 * 24 * 60 * 60 * 1000);
    const ageMonths = ageInMonths(doc.dateOfBirth, occurredAt);

    const candidates = SCENARIOS.filter((s) => !s.when || s.when(demo, ageMonths));
    let roll = rand() * candidates.reduce((sum, s) => sum + s.weight, 0);
    const scenario = candidates.find((s) => (roll -= s.weight) < 0) ?? candidates[0]!;

    const input: TriageContext = {
      symptoms: scenario.symptoms,
      ageMonths,
      sex: demo.sex,
      ...(demo.pregnant ? { pregnant: true } : {}),
      ...(scenario.fever ? { temperatureC: Math.round((38.2 + rand() * 1.4) * 10) / 10 } : {}),
    };

    // Real rule engine. For non-emergencies the model isn't trained yet (Phase 3), so ~90% use the
    // scenario's demo level (labelled modelVersion "demo-seed") and ~10% show the rules-only fallback.
    const redFlags = redFlagEngine.evaluate(input);
    const model: ModelOutcome | null = redFlags.isEmergency
      ? null
      : rand() < 0.1
        ? { status: 'unavailable', reason: 'AI service unreachable' }
        : {
            status: 'ok',
            prediction: {
              level: scenario.demoLevel,
              confidence: Math.round((0.6 + rand() * 0.35) * 100) / 100,
              modelVersion: 'demo-seed',
              topConditions: [],
            },
          };
    const decision = decideTriage(redFlags, model, MODEL_UNAVAILABLE_FALLBACK_LEVEL);

    const ageDays = (now.getTime() - occurredAt.getTime()) / (24 * 60 * 60 * 1000);
    const reviewed = ageDays > 2 && rand() < 0.7;
    const doctor = pick(doctors);
    const reviewedAt = new Date(occurredAt.getTime() + (2 + rand() * 20) * 60 * 60 * 1000);

    sessions.push({
      clientId: randomUUID(),
      patientId: doc._id,
      villageId: doc.villageId,
      performedBy: demo.login && rand() < 0.5 ? doc.userId! : healthWorkerFor(doc.villageId)._id,
      origin: 'seed' as const,
      occurredAt,
      input,
      result: decisionToResult(decision),
      review: reviewed
        ? {
            status: 'reviewed' as const,
            reviewedBy: doctor._id,
            reviewedAt,
            notes: [{ doctorId: doctor._id, text: pick(REVIEW_NOTES), createdAt: reviewedAt }],
          }
        : { status: 'pending' as const, notes: [] },
    });
  }
  await TriageSession.insertMany(sessions);

  return {
    villages: villages.length,
    users: staff.length + credentials.filter((c) => c.role === 'patient').length,
    patients: patients.length,
    sessions: sessions.length,
    credentials,
  };
}
