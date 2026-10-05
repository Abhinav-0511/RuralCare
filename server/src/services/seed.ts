// Demo data for development and dashboards. All people and phone numbers are fictional.
// Villages are real places near Chennai (approximate coordinates).
import { randomUUID } from 'node:crypto';
import { type Sex, type TriageContext } from '@ruralcare/shared';
import bcrypt from 'bcryptjs';
import type { HydratedDocument, Types } from 'mongoose';
import { ageInMonths } from '../lib/dates';
import { Patient, type PatientFields } from '../models/patient';
import { TriageSession } from '../models/triageSession';
import { User } from '../models/user';
import { Alert } from '../models/alert';
import { Device } from '../models/device';
import { Village } from '../models/village';
import type { AiClient } from './aiClient';
import { decisionToResult, evaluateTriage } from './triageService';

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

const DEVICE_PATIENTS = [
  'Lakshmi Murugan',
  'Arumugam Pillai',
  'Janaki Ammal',
  'Selvi Ganesan',
  'Palani Samy',
];

interface Scenario {
  symptoms: string[];
  fever?: boolean;
  weight: number;
  when?: (p: DemoPatient, ageMonths: number) => boolean;
}

const isInfant = (_p: DemoPatient, m: number) => m < 12;
const notInfant = (_p: DemoPatient, m: number) => m >= 12;

const SCENARIOS: Scenario[] = [
  { symptoms: ['cough', 'runny_nose', 'congestion', 'sinus_pressure'], weight: 6 },
  {
    symptoms: ['diarrhoea', 'vomiting', 'dehydration'],
    weight: 3,
    when: notInfant,
  },
  {
    symptoms: ['burning_micturition', 'abdominal_pain'],
    weight: 2,
    when: notInfant,
  },
  {
    symptoms: ['yellowish_skin', 'dark_urine', 'fatigue', 'loss_of_appetite'],
    weight: 1,
    when: notInfant,
  },
  {
    symptoms: ['high_fever', 'joint_pain', 'headache', 'skin_rash'],
    fever: true,
    weight: 3,
  },
  { symptoms: ['itching', 'skin_rash'], weight: 2 },
  { symptoms: ['back_pain', 'muscle_pain'], weight: 2, when: notInfant },
  {
    symptoms: ['headache', 'fatigue', 'dizziness'],
    weight: 2,
    when: notInfant,
  },
  { symptoms: ['mild_fever', 'cough', 'throat_irritation'], fever: true, weight: 3 },
  { symptoms: ['chest_pain', 'sweating'], weight: 1, when: (_p, m) => m >= 360 },
  { symptoms: ['breathlessness', 'cough'], weight: 1 },
  {
    symptoms: ['slurred_speech', 'weakness_of_one_body_side'],
    weight: 1,
    when: (_p, m) => m >= 600,
  },
  {
    symptoms: ['vaginal_bleeding', 'abdominal_pain'],
    weight: 2,
    when: (p) => !!p.pregnant,
  },
  { symptoms: ['high_fever'], fever: true, weight: 4, when: isInfant },
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
  devices: { deviceId: string; patientName: string }[];
  credentials: { role: string; name: string; phone: string }[];
}

export async function seedDemoData(options: {
  bcryptRounds: number;
  /** Sessions are evaluated exactly like live triage: rules first, then this AI client. */
  ai: AiClient;
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
    Device.deleteMany({}),
    Alert.deleteMany({}),
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

  const patients: { demo: DemoPatient; doc: HydratedDocument<PatientFields> }[] = [];
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

    // Same path as POST /api/triage: red-flag rules, then the real model via the AI service.
    const decision = await evaluateTriage(input, options.ai);

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

  // One home vitals device for an adult patient in five of the villages (MQTT simulator in /edge).
  const devices = await Device.insertMany(
    DEVICE_PATIENTS.map((name, i) => ({
      deviceId: `rc-dev-0${i + 1}`,
      patientId: patients.find((p) => p.demo.name === name)!.doc._id,
      label: `Home vitals monitor ${i + 1}`,
    })),
  );

  return {
    devices: devices.map((d, i) => ({ deviceId: d.deviceId, patientName: DEVICE_PATIENTS[i]! })),
    villages: villages.length,
    users: staff.length + credentials.filter((c) => c.role === 'patient').length,
    patients: patients.length,
    sessions: sessions.length,
    credentials,
  };
}
