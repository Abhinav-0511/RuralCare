// Request/response schemas. Used for validation in the routes AND to generate the OpenAPI spec,
// so the docs can't drift from what the API actually accepts.
import {
  LOCALES,
  LocalizedTextSchema,
  NON_EMERGENCY_LEVELS,
  SEXES,
  TRIAGE_LEVELS,
  TriageContextSchema,
  TriageInputSchema,
} from '@ruralcare/shared';
import { z } from 'zod';
import { MODEL_STATUSES, REVIEW_STATUSES, SESSION_ORIGINS, TRIAGE_SOURCES } from '../models/triageSession';
import { ROLES } from '../models/user';

// ───────────────────────────── Common ─────────────────────────────

export const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id')
  .meta({ example: '665f1c2e8b3e4a0012345678' });

export const IdParamsSchema = z.object({ id: ObjectIdSchema });

/** Accepts "98765 43210", "+91 9876543210", "09876543210" and stores 10 digits. */
export const PhoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'))
  .meta({ example: '9000000001' });

export const PasswordSchema = z.string().min(8).max(128);

export const DateOfBirthSchema = z.iso
  .date()
  .refine((d) => new Date(d) <= new Date(), 'Date of birth cannot be in the future')
  .meta({ example: '1990-05-14' });

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ErrorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  })
  .meta({ id: 'Error' });

const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), page: z.number(), limit: z.number(), total: z.number() });

// ───────────────────────────── Auth & users ─────────────────────────────

export const RoleSchema = z.enum(ROLES);

export const UserSchema = z
  .object({
    id: ObjectIdSchema,
    name: z.string(),
    phone: z.string(),
    email: z.string().optional(),
    role: RoleSchema,
    villageIds: z.array(ObjectIdSchema),
    patientId: ObjectIdSchema.optional(),
    preferredLanguage: z.enum(LOCALES),
    isActive: z.boolean(),
    mustChangePassword: z
      .boolean()
      .optional()
      .meta({ description: 'Temporary password: only /api/auth/change-password, /me and /logout work' }),
    ...timestamps,
  })
  .meta({ id: 'User' });

export const TokensSchema = z
  .object({ accessToken: z.string(), refreshToken: z.string(), tokenType: z.literal('Bearer') })
  .meta({ id: 'Tokens' });

export const AuthResponseSchema = z
  .object({ user: UserSchema, tokens: TokensSchema })
  .meta({ id: 'AuthResponse' });

export const RegisterBodySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone: PhoneSchema,
    password: PasswordSchema,
    sex: z.enum(SEXES),
    dateOfBirth: DateOfBirthSchema,
    villageId: ObjectIdSchema,
    preferredLanguage: z.enum(LOCALES).optional(),
  })
  .meta({ id: 'RegisterBody' });

export const LoginBodySchema = z
  .object({ phone: PhoneSchema, password: z.string().min(1) })
  .meta({ id: 'LoginBody' });

export const RefreshBodySchema = z.object({ refreshToken: z.string().min(1) }).meta({ id: 'RefreshBody' });

export const ChangePasswordBodySchema = z
  .object({ currentPassword: z.string().min(1), newPassword: PasswordSchema })
  .refine((b) => b.newPassword !== b.currentPassword, {
    message: 'The new password must be different',
    path: ['newPassword'],
  })
  .meta({ id: 'ChangePasswordBody' });

export const OtpRequestBodySchema = z.object({ phone: PhoneSchema }).meta({ id: 'OtpRequestBody' });

export const OtpRequestResponseSchema = z
  .object({
    message: z.string(),
    expiresInSeconds: z.number().int(),
    devOtp: z.string().optional().meta({
      description:
        'Development only (OTP_DEV_ECHO). Present for EVERY phone number, so it does not reveal which numbers exist; it only works for real accounts.',
    }),
  })
  .meta({ id: 'OtpRequestResponse' });

export const OtpConfirmBodySchema = z
  .object({
    phone: PhoneSchema,
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    newPassword: PasswordSchema,
  })
  .meta({ id: 'OtpConfirmBody' });

export const MessageSchema = z.object({ message: z.string() }).meta({ id: 'Message' });

export const TemporaryLoginSchema = z
  .object({
    phone: z.string(),
    temporaryPassword: z.string().meta({ description: 'Shown once. Must be changed at first login.' }),
  })
  .meta({ id: 'TemporaryLogin' });

export const CreateUserBodySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone: PhoneSchema,
    password: PasswordSchema.optional().meta({
      description:
        'If omitted, a temporary password is generated and returned once (must be changed at first login)',
    }),
    role: z.enum(['health_worker', 'doctor', 'admin']),
    email: z.email().optional(),
    villageIds: z.array(ObjectIdSchema).max(50).optional(),
    preferredLanguage: z.enum(LOCALES).optional(),
  })
  .meta({ id: 'CreateUserBody' });

export const UpdateUserBodySchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    role: z.enum(['health_worker', 'doctor', 'admin']).optional(),
    villageIds: z.array(ObjectIdSchema).max(50).optional(),
    isActive: z.boolean().optional(),
    preferredLanguage: z.enum(LOCALES).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')
  .meta({ id: 'UpdateUserBody' });

export const CreatedUserSchema = UserSchema.extend({
  temporaryPassword: z
    .string()
    .optional()
    .meta({ description: 'Only when no password was given; shown once' }),
}).meta({ id: 'CreatedUser' });

export const ListUsersQuerySchema = PaginationQuerySchema.extend({ role: RoleSchema.optional() });
export const UserListSchema = paginated(UserSchema).meta({ id: 'UserList' });

// ───────────────────────────── Villages & patients ─────────────────────────────

export const VillageSchema = z
  .object({
    id: ObjectIdSchema,
    name: z.string(),
    district: z.string(),
    state: z.string(),
    location: z.object({ lat: z.number(), lng: z.number() }).optional(),
    ...timestamps,
  })
  .meta({ id: 'Village' });

export const CreateVillageBodySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    district: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100).optional(),
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  })
  .meta({ id: 'CreateVillageBody' });

export const UpdateVillageBodySchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    district: z.string().trim().min(2).max(100).optional(),
    state: z.string().trim().min(2).max(100).optional(),
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')
  .meta({ id: 'UpdateVillageBody' });

export const PatientSchema = z
  .object({
    id: ObjectIdSchema,
    name: z.string(),
    sex: z.enum(SEXES),
    dateOfBirth: z.iso.datetime(),
    ageMonths: z.number().int(),
    villageId: ObjectIdSchema,
    phone: z.string().optional(),
    userId: ObjectIdSchema.optional(),
    registeredBy: ObjectIdSchema.optional(),
    ...timestamps,
  })
  .meta({ id: 'Patient' });

export const CreatePatientBodySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    sex: z.enum(SEXES),
    dateOfBirth: DateOfBirthSchema,
    villageId: ObjectIdSchema,
    phone: PhoneSchema.optional(),
    preferredLanguage: z.enum(LOCALES).optional().meta({ description: 'For the login, if one is created' }),
    createLogin: z.boolean().optional().meta({
      description: 'Also create a patient login (phone required); a temporary password is returned once',
    }),
    allowDuplicatePhone: z.boolean().optional().meta({
      description: 'Register even if another patient has this phone (e.g. a shared family phone)',
    }),
  })
  .refine((b) => !b.createLogin || b.phone, {
    message: 'A phone number is needed for a login',
    path: ['phone'],
  })
  .meta({ id: 'CreatePatientBody' });

export const CreatedPatientSchema = PatientSchema.extend({
  login: TemporaryLoginSchema.optional(),
}).meta({ id: 'CreatedPatient' });

export const ListPatientsQuerySchema = PaginationQuerySchema.extend({
  villageId: ObjectIdSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export const PatientListSchema = paginated(PatientSchema).meta({ id: 'PatientList' });

// ───────────────────────────── Triage ─────────────────────────────

const LevelSchema = z.enum(TRIAGE_LEVELS);
const SourceSchema = z.enum(TRIAGE_SOURCES);

export const TriageInputBodySchema = TriageInputSchema.meta({
  id: 'TriageInput',
  description: 'Patient context for a new triage. ageMonths is required.',
});

export const TriageRequestBodySchema = z
  .object({
    clientId: z
      .uuid()
      .optional()
      .meta({ description: 'Idempotency key; generated by the server if omitted' }),
    patientId: ObjectIdSchema.optional().meta({
      description: "Defaults to the caller's own record for patients",
    }),
    input: TriageInputBodySchema,
  })
  .meta({ id: 'TriageRequest' });

export const ClientResultSchema = z
  .object({
    level: LevelSchema,
    source: SourceSchema,
    rulesVersion: z.string().max(32),
    modelVersion: z.string().max(64).optional(),
  })
  .meta({ id: 'ClientResult', description: 'What the device showed offline (kept for audit)' });

export const SyncItemSchema = z
  .object({
    clientId: z.uuid(),
    patientId: ObjectIdSchema,
    clientCreatedAt: z.iso.datetime({ offset: true }),
    // Age is optional here: an offline record must never be dropped. Safety floors cover missing age.
    input: TriageContextSchema.meta({ id: 'TriageContext' }),
    clientResult: ClientResultSchema.optional(),
  })
  .meta({ id: 'SyncItem' });

export const SyncBodySchema = z
  .object({ sessions: z.array(SyncItemSchema).min(1).max(50) })
  .meta({ id: 'SyncRequest' });

export const SyncResultItemSchema = z
  .object({
    clientId: z.string(),
    status: z.enum(['created', 'duplicate', 'rejected']),
    sessionId: ObjectIdSchema.optional(),
    level: LevelSchema.optional(),
    verdictChanged: z.boolean().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  .meta({ id: 'SyncResultItem' });

export const SyncResponseSchema = z
  .object({ results: z.array(SyncResultItemSchema) })
  .meta({ id: 'SyncResponse' });

export const GuestTriageBodySchema = z
  .object({ input: TriageInputBodySchema })
  .meta({ id: 'GuestTriageRequest' });

export const GuestClaimBodySchema = z
  .object({
    sessions: z
      .array(SyncItemSchema.omit({ patientId: true }))
      .min(1)
      .max(50),
  })
  .meta({ id: 'GuestClaimRequest' });

export const TriageSessionSchema = z
  .object({
    id: ObjectIdSchema,
    clientId: z.string(),
    patientId: ObjectIdSchema,
    villageId: ObjectIdSchema,
    performedBy: ObjectIdSchema,
    origin: z.enum(SESSION_ORIGINS),
    occurredAt: z.iso.datetime(),
    input: TriageContextSchema,
    vitalsSource: z.enum(['manual', 'device', 'combined']).nullable().optional(),
    vitalsMeasuredAt: z.iso.datetime().optional(),
    result: z.object({
      level: LevelSchema,
      source: SourceSchema,
      redFlags: z.array(z.string()),
      safetyFloors: z.array(z.string()),
      rulesVersion: z.string(),
      model: z.object({
        status: z.enum(MODEL_STATUSES),
        modelVersion: z.string().optional(),
        confidence: z.number().optional(),
        reason: z.string().optional(),
        lowConfidence: z.boolean().optional(),
        topConditions: z.array(z.object({ id: z.string(), probability: z.number() })).optional(),
      }),
    }),
    clientResult: ClientResultSchema.optional(),
    verdictChanged: z.boolean(),
    patientName: z.string().nullable().optional().meta({ description: 'Included in lists' }),
    review: z.object({
      status: z.enum(REVIEW_STATUSES),
      reviewedBy: ObjectIdSchema.optional(),
      reviewedAt: z.iso.datetime().optional(),
      notes: z.array(
        z.object({
          _id: ObjectIdSchema,
          doctorId: ObjectIdSchema,
          text: z.string(),
          createdAt: z.iso.datetime(),
        }),
      ),
    }),
    ...timestamps,
  })
  .meta({ id: 'TriageSession' });

export const GuidanceSchema = z
  .object({
    title: LocalizedTextSchema,
    advice: LocalizedTextSchema,
    disclaimer: LocalizedTextSchema,
    notice: LocalizedTextSchema.optional().meta({
      description: 'Present when the model was unavailable and the result is rules-only',
    }),
    reasons: z.array(LocalizedTextSchema),
    possibleConditions: z
      .array(
        z.object({
          id: z.string(),
          probability: z.number(),
          triageLevel: z.enum(NON_EMERGENCY_LEVELS),
          name: LocalizedTextSchema,
          advice: LocalizedTextSchema,
        }),
      )
      .meta({ description: 'Top model suggestions (not a diagnosis); empty unless the model decided' }),
  })
  .meta({ id: 'Guidance' });

export const TriageResponseSchema = z
  .object({ session: TriageSessionSchema, guidance: GuidanceSchema, duplicate: z.boolean() })
  .meta({ id: 'TriageResponse' });

export const GuestTriageResponseSchema = z
  .object({
    result: TriageSessionSchema.shape.result,
    guidance: GuidanceSchema,
    stored: z.literal(false).meta({ description: 'Guest results are never stored on the server' }),
  })
  .meta({ id: 'GuestTriageResponse' });

export const SessionWithGuidanceSchema = z
  .object({ session: TriageSessionSchema, guidance: GuidanceSchema })
  .meta({ id: 'SessionWithGuidance' });

export const ListSessionsQuerySchema = PaginationQuerySchema.extend({
  level: LevelSchema.optional(),
  villageId: ObjectIdSchema.optional(),
  patientId: ObjectIdSchema.optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z
    .enum(['recent', 'urgency'])
    .default('recent')
    .meta({ description: '`urgency`: EMERGENCY first, then by level, newest first within a level' }),
});
export const SessionListSchema = paginated(TriageSessionSchema).meta({ id: 'TriageSessionList' });

export const NoteBodySchema = z.object({ text: z.string().trim().min(1).max(2000) }).meta({ id: 'NoteBody' });
export const ReviewBodySchema = z
  .object({ note: z.string().trim().min(1).max(2000).optional() })
  .meta({ id: 'ReviewBody' });

// ───────────────────────────── Dashboard ─────────────────────────────

const LevelCountsSchema = z.object(
  Object.fromEntries(TRIAGE_LEVELS.map((l) => [l, z.number().int()])) as Record<
    (typeof TRIAGE_LEVELS)[number],
    z.ZodNumber
  >,
);

export const StatsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional().meta({ description: 'Default: 30 days before `to`' }),
  to: z.iso.datetime({ offset: true }).optional().meta({ description: 'Default: now' }),
  villageId: ObjectIdSchema.optional(),
  interval: z.enum(['day', 'week']).default('day'),
});

export const StatsResponseSchema = z
  .object({
    range: z.object({ from: z.iso.datetime(), to: z.iso.datetime(), interval: z.enum(['day', 'week']) }),
    total: z.number().int(),
    pendingReview: z.number().int(),
    modelUnavailable: z.number().int().meta({ description: 'Sessions decided by the rules-only fallback' }),
    byLevel: LevelCountsSchema,
    byVillage: z.array(
      z.object({
        villageId: ObjectIdSchema,
        villageName: z.string(),
        total: z.number().int(),
        byLevel: LevelCountsSchema,
      }),
    ),
    overTime: z.array(
      z.object({
        date: z.string().meta({ description: 'Bucket start (YYYY-MM-DD, IST)' }),
        total: z.number().int(),
        byLevel: LevelCountsSchema,
      }),
    ),
  })
  .meta({ id: 'DashboardStats' });

export const ModelVersionResponseSchema = z
  .object({
    modelVersion: z.string(),
    algorithm: z.string(),
    createdAt: z.string(),
    sha256: z.string(),
    sizeBytes: z.number().int(),
    featureCount: z.number().int(),
    classCount: z.number().int(),
  })
  .meta({ id: 'ModelVersion' });

// ───────────────────────────── Vitals & alerts ─────────────────────────────

export const VitalsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional().meta({ description: 'Default: 24 hours before `to`' }),
  to: z.iso.datetime({ offset: true }).optional().meta({ description: 'Default: now' }),
  bucket: z.enum(['1m', '5m', '15m', '1h', '1d']).optional().meta({
    description:
      'time_bucket width. Default depends on the range. 1h/1d read the hourly continuous aggregate.',
  }),
});

export const LatestVitalsQuerySchema = z.object({
  windowMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});

const nullableNumber = z.number().nullable();

export const VitalsSeriesSchema = z
  .object({
    patientId: ObjectIdSchema,
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    bucket: z.enum(['1m', '5m', '15m', '1h', '1d']),
    bucketInterval: z.string(),
    source: z.enum(['vitals', 'vitals_hourly']),
    points: z.array(
      z.object({
        time: z.iso.datetime(),
        heartRate: nullableNumber,
        spo2: nullableNumber,
        temperatureC: nullableNumber,
        systolicBp: nullableNumber,
        diastolicBp: nullableNumber,
        minSpo2: nullableNumber,
        maxHeartRate: nullableNumber,
        maxTemperatureC: nullableNumber,
        readings: z.number().int(),
      }),
    ),
  })
  .meta({ id: 'VitalsSeries' });

const VitalAlertSchema = z.object({
  code: z.string(),
  severity: z.enum(['warning', 'critical']),
  vital: z.string(),
  value: z.number(),
  threshold: z.number(),
  label: LocalizedTextSchema,
});

export const LatestVitalsSchema = z
  .object({
    patientId: ObjectIdSchema,
    windowMinutes: z.number().int(),
    measuredAt: z.iso.datetime().nullable(),
    vitals: z
      .object({
        heartRate: z.number().optional(),
        spo2: z.number().optional(),
        temperatureC: z.number().optional(),
        systolicBp: z.number().optional(),
        diastolicBp: z.number().optional(),
      })
      .nullable(),
    alerts: z.array(VitalAlertSchema),
  })
  .meta({ id: 'LatestVitals' });

export const AlertSchema = z
  .object({
    id: ObjectIdSchema,
    patientId: ObjectIdSchema,
    patientName: z.string().nullable(),
    villageId: ObjectIdSchema,
    deviceId: z.string(),
    code: z.string(),
    severity: z.enum(['warning', 'critical']),
    vital: z.string(),
    value: z.number(),
    threshold: z.number(),
    label: LocalizedTextSchema.nullable(),
    firstSeenAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
    count: z.number().int(),
    acknowledged: z.boolean(),
    acknowledgedBy: ObjectIdSchema.optional(),
    acknowledgedAt: z.iso.datetime().optional(),
    acknowledgeNote: z.string().optional(),
  })
  .meta({ id: 'Alert' });

export const AlertListSchema = paginated(AlertSchema).meta({ id: 'AlertList' });

export const ListAlertsQuerySchema = PaginationQuerySchema.extend({
  acknowledged: z.enum(['true', 'false']).optional(),
  severity: z.enum(['warning', 'critical']).optional(),
  patientId: ObjectIdSchema.optional(),
  villageId: ObjectIdSchema.optional(),
});

export const AcknowledgeAlertBodySchema = z
  .object({
    acknowledged: z.literal(true),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .meta({ id: 'AcknowledgeAlertBody' });
