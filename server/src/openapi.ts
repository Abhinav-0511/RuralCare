import { OpenApiGeneratorV31, OpenAPIRegistry, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as S from './schemas/api';

const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = (schema: z.ZodType) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const errors = {
  400: json(S.ErrorSchema, 'Validation error'),
  401: json(S.ErrorSchema, 'Missing or invalid token'),
  403: json(S.ErrorSchema, 'Not allowed for this role / scope'),
} as const;

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  const secured = [{ [bearer.name]: [] }];
  const path = (config: RouteConfig) => registry.registerPath(config);

  // ── Auth ──
  path({
    method: 'post',
    path: '/api/auth/register',
    tags: ['Auth'],
    summary: 'Disabled: patient self-registration',
    description:
      'Always `410 SELF_REGISTRATION_DISABLED`; no account is created. Patients are registered by a ' +
      'health worker (`POST /api/patients` with `createLogin`), staff by an admin (`POST /api/users`).',
    deprecated: true,
    responses: { 410: json(S.ErrorSchema, 'Self-registration is disabled') },
  });
  path({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Auth'],
    summary: 'Log in with phone number and password',
    request: body(S.LoginBodySchema),
    responses: {
      200: json(S.AuthResponseSchema, 'Logged in'),
      401: json(S.ErrorSchema, 'Invalid credentials'),
      403: json(S.ErrorSchema, 'Account disabled'),
    },
  });
  path({
    method: 'post',
    path: '/api/auth/refresh',
    tags: ['Auth'],
    summary: 'Exchange a refresh token for a new token pair',
    request: body(S.RefreshBodySchema),
    responses: { 200: json(S.AuthResponseSchema, 'New tokens'), 401: errors[401] },
  });
  path({
    method: 'post',
    path: '/api/auth/logout',
    tags: ['Auth'],
    summary: 'Revoke all tokens of the current user',
    security: secured,
    responses: { 204: { description: 'Logged out' }, 401: errors[401] },
  });
  path({
    method: 'get',
    path: '/api/auth/me',
    tags: ['Auth'],
    summary: 'Current user',
    security: secured,
    responses: { 200: json(S.UserSchema, 'Current user'), 401: errors[401] },
  });
  path({
    method: 'post',
    path: '/api/auth/change-password',
    tags: ['Auth'],
    summary: 'Set a new password (required after a temporary one)',
    description:
      'Revokes all other sessions and returns a new token pair. Allowed while `mustChangePassword` is set.',
    security: secured,
    request: body(S.ChangePasswordBodySchema),
    responses: {
      200: json(S.AuthResponseSchema, 'Password changed'),
      400: errors[400],
      401: json(S.ErrorSchema, 'Wrong current password or invalid token'),
    },
  });
  path({
    method: 'post',
    path: '/api/auth/password-reset/request',
    tags: ['Auth'],
    summary: 'Forgot password: send a 6-digit code by SMS',
    description:
      'Same answer whether or not the phone has an account. Limits: per phone per hour, and per IP. ' +
      'The code expires after OTP_TTL_SECONDS (default 5 min); a new request replaces the old code.',
    request: body(S.OtpRequestBodySchema),
    responses: {
      202: json(S.OtpRequestResponseSchema, 'Accepted (a code is sent only if the account exists)'),
      400: errors[400],
      429: json(S.ErrorSchema, 'Too many requests'),
    },
  });
  path({
    method: 'post',
    path: '/api/auth/password-reset/confirm',
    tags: ['Auth'],
    summary: 'Forgot password: set a new password with the code',
    description: 'Wrong, expired, used or unknown codes all give `400 INVALID_OTP`. Revokes all sessions.',
    request: body(S.OtpConfirmBodySchema),
    responses: {
      200: json(S.MessageSchema, 'Password changed'),
      400: json(S.ErrorSchema, 'INVALID_OTP or validation error'),
      429: json(S.ErrorSchema, 'Too many requests'),
    },
  });

  // ── Users (admin) ──
  path({
    method: 'get',
    path: '/api/users',
    tags: ['Users'],
    summary: 'List users (admin)',
    security: secured,
    request: { query: S.ListUsersQuerySchema },
    responses: { 200: json(S.UserListSchema, 'Users'), ...errors },
  });
  path({
    method: 'post',
    path: '/api/users',
    tags: ['Users'],
    summary: 'Create a staff account (admin)',
    security: secured,
    request: body(S.CreateUserBodySchema),
    responses: {
      201: json(S.CreatedUserSchema, 'Created'),
      ...errors,
      409: json(S.ErrorSchema, 'Phone taken'),
    },
  });
  path({
    method: 'post',
    path: '/api/users/{id}/reset-password',
    tags: ['Users'],
    summary: 'New temporary password for a staff account (admin)',
    security: secured,
    request: { params: S.IdParamsSchema },
    responses: {
      200: json(S.TemporaryLoginSchema, 'Temporary password (shown once)'),
      ...errors,
      404: json(S.ErrorSchema, 'Not found'),
    },
  });
  path({
    method: 'patch',
    path: '/api/users/{id}',
    tags: ['Users'],
    summary: 'Update role, villages or active status (admin)',
    security: secured,
    request: { params: S.IdParamsSchema, ...body(S.UpdateUserBodySchema) },
    responses: { 200: json(S.UserSchema, 'Updated'), ...errors, 404: json(S.ErrorSchema, 'Not found') },
  });

  // ── Villages ──
  path({
    method: 'get',
    path: '/api/villages',
    tags: ['Villages'],
    summary: 'List villages (public)',
    request: { query: S.ListVillagesQuerySchema },
    responses: { 200: json(z.array(S.VillageSchema), 'Villages') },
  });
  path({
    method: 'post',
    path: '/api/villages',
    tags: ['Villages'],
    summary: 'Create a village (admin)',
    security: secured,
    request: body(S.CreateVillageBodySchema),
    responses: { 201: json(S.VillageSchema, 'Created'), ...errors },
  });
  path({
    method: 'patch',
    path: '/api/villages/{id}',
    tags: ['Villages'],
    summary: 'Edit a village (admin)',
    security: secured,
    request: { params: S.IdParamsSchema, ...body(S.UpdateVillageBodySchema) },
    responses: { 200: json(S.VillageSchema, 'Updated'), ...errors, 404: json(S.ErrorSchema, 'Not found') },
  });

  // ── Patients ──
  path({
    method: 'get',
    path: '/api/patients',
    tags: ['Patients'],
    summary: 'List patients in scope (health worker: own villages)',
    security: secured,
    request: { query: S.ListPatientsQuerySchema },
    responses: { 200: json(S.PatientListSchema, 'Patients'), ...errors },
  });
  path({
    method: 'post',
    path: '/api/patients',
    tags: ['Patients'],
    summary: 'Register a patient (health worker: own villages; admin)',
    description:
      'With `createLogin`, also creates a patient login (role fixed to patient) and returns a temporary ' +
      'password once. `409 DUPLICATE_PHONE` warns that another patient has this phone (repeat with ' +
      '`allowDuplicatePhone: true` to register anyway); `409 PHONE_TAKEN` if a login already uses it.',
    security: secured,
    request: body(S.CreatePatientBodySchema),
    responses: {
      201: json(S.CreatedPatientSchema, 'Created'),
      ...errors,
      409: json(S.ErrorSchema, 'DUPLICATE_PHONE or PHONE_TAKEN'),
    },
  });
  path({
    method: 'post',
    path: '/api/patients/{id}/login',
    tags: ['Patients'],
    summary: 'Create a login for a patient registered without one (health worker: own villages; admin)',
    description:
      "Uses the record's phone, or `phone` if the record has none (it is then saved on the record). " +
      'Returns a temporary password once; it must be changed at first login.',
    security: secured,
    request: { params: S.IdParamsSchema, ...body(S.CreatePatientLoginBodySchema) },
    responses: {
      201: json(S.TemporaryLoginSchema, 'Login created (temporary password shown once)'),
      ...errors,
      404: json(S.ErrorSchema, 'Not found'),
      409: json(S.ErrorSchema, 'LOGIN_EXISTS or PHONE_TAKEN'),
    },
  });
  path({
    method: 'post',
    path: '/api/patients/{id}/reset-password',
    tags: ['Patients'],
    summary: "New temporary password for a patient's login (health worker: own villages; admin)",
    security: secured,
    request: { params: S.IdParamsSchema },
    responses: {
      200: json(S.TemporaryLoginSchema, 'Temporary password (shown once)'),
      ...errors,
      404: json(S.ErrorSchema, 'Not found'),
    },
  });
  path({
    method: 'get',
    path: '/api/patients/{id}',
    tags: ['Patients'],
    summary: 'Get a patient',
    security: secured,
    request: { params: S.IdParamsSchema },
    responses: { 200: json(S.PatientSchema, 'Patient'), ...errors, 404: json(S.ErrorSchema, 'Not found') },
  });

  // ── Triage ──
  path({
    method: 'post',
    path: '/api/triage',
    tags: ['Triage'],
    summary: 'Run triage (red-flag rules first, then the model)',
    description:
      'Red-flag rules run first; if one matches the result is EMERGENCY and the model is not called. ' +
      'If the AI service is unavailable the result comes from the rules-only fallback ' +
      '(`result.source = rule_engine_fallback`, never SELF_CARE) and `guidance.notice` explains this. ' +
      'Idempotent on `clientId`: repeating a request returns the original session with `duplicate: true`.',
    security: secured,
    request: body(S.TriageRequestBodySchema),
    responses: {
      201: json(S.TriageResponseSchema, 'Session created'),
      200: json(S.TriageResponseSchema, 'Duplicate clientId: existing session returned'),
      ...errors,
      409: json(S.ErrorSchema, 'clientId belongs to another patient'),
    },
  });
  path({
    method: 'post',
    path: '/api/triage/sync',
    tags: ['Triage'],
    summary: 'Upload sessions recorded offline (idempotent per clientId)',
    description:
      'Each session is re-evaluated by the server, whose verdict wins; `verdictChanged` flags a ' +
      'difference from what the device showed. Per-item failures are reported as `rejected` ' +
      'without failing the batch.',
    security: secured,
    request: body(S.SyncBodySchema),
    responses: { 200: json(S.SyncResponseSchema, 'Per-session results'), ...errors },
  });
  path({
    method: 'post',
    path: '/api/triage/guest-claims',
    tags: ['Triage'],
    summary: 'Add guest checks made on this phone to my record (patient)',
    description:
      'Same processing as `/api/triage/sync` (re-evaluated, idempotent per clientId), for the ' +
      "caller's own patient record; sessions are stored with `origin: guest`.",
    security: secured,
    request: body(S.GuestClaimBodySchema),
    responses: { 200: json(S.SyncResponseSchema, 'Per-session results'), ...errors },
  });
  path({
    method: 'post',
    path: '/api/guest/triage',
    tags: ['Triage'],
    summary: 'Triage without an account (public, rate-limited, stores nothing)',
    description:
      'Same red-flag rules, safety floors and model as `/api/triage`. Nothing is stored on the server; ' +
      'the result is kept only on the device.',
    request: body(S.GuestTriageBodySchema),
    responses: {
      200: json(S.GuestTriageResponseSchema, 'Result (not stored)'),
      400: errors[400],
      429: json(S.ErrorSchema, 'Too many requests'),
    },
  });
  path({
    method: 'get',
    path: '/api/triage',
    tags: ['Triage'],
    summary: 'List sessions in scope',
    security: secured,
    request: { query: S.ListSessionsQuerySchema },
    responses: { 200: json(S.SessionListSchema, 'Sessions'), ...errors },
  });
  path({
    method: 'get',
    path: '/api/triage/{id}',
    tags: ['Triage'],
    summary: 'Get a session with guidance',
    security: secured,
    request: { params: S.IdParamsSchema },
    responses: {
      200: json(S.SessionWithGuidanceSchema, 'Session'),
      ...errors,
      404: json(S.ErrorSchema, 'Not found'),
    },
  });
  path({
    method: 'post',
    path: '/api/triage/{id}/notes',
    tags: ['Doctor review'],
    summary: 'Add a doctor note (doctor)',
    security: secured,
    request: { params: S.IdParamsSchema, ...body(S.NoteBodySchema) },
    responses: { 201: json(S.SessionWithGuidanceSchema, 'Note added'), ...errors },
  });
  path({
    method: 'post',
    path: '/api/triage/{id}/review',
    tags: ['Doctor review'],
    summary: 'Mark a session reviewed, optionally with a note (doctor)',
    security: secured,
    request: {
      params: S.IdParamsSchema,
      body: { content: { 'application/json': { schema: S.ReviewBodySchema } } },
    },
    responses: {
      200: json(S.SessionWithGuidanceSchema, 'Reviewed'),
      ...errors,
      409: json(S.ErrorSchema, 'Already reviewed'),
    },
  });

  // ── Model ──
  path({
    method: 'get',
    path: '/api/model/version',
    tags: ['Model'],
    summary: 'Current triage model version and file hash (public)',
    description:
      'The PWA compares `sha256` with its cached `/models/triage_model.onnx` to decide whether to download ' +
      'a new model. Proxied from the AI service.',
    responses: {
      200: json(S.ModelVersionResponseSchema, 'Model version'),
      503: json(S.ErrorSchema, 'AI service or model unavailable'),
    },
  });

  // ── Vitals & alerts ──
  path({
    method: 'get',
    path: '/api/vitals/{id}',
    tags: ['Vitals'],
    summary: "A patient's vitals as time_bucket() averages (TimescaleDB)",
    description:
      'Minute buckets read raw readings; `1h`/`1d` read the `vitals_hourly` continuous aggregate. ' +
      'Same access rules as GET /api/patients/{id}. 503 if vitals storage is not configured.',
    security: secured,
    request: { params: S.IdParamsSchema, query: S.VitalsQuerySchema },
    responses: {
      200: json(S.VitalsSeriesSchema, 'Series'),
      ...errors,
      503: json(S.ErrorSchema, 'Vitals disabled'),
    },
  });
  path({
    method: 'get',
    path: '/api/vitals/{id}/latest',
    tags: ['Vitals'],
    summary: 'Newest value of each vital in a window (default 30 min) and the alerts they raise',
    security: secured,
    request: { params: S.IdParamsSchema, query: S.LatestVitalsQuerySchema },
    responses: { 200: json(S.LatestVitalsSchema, 'Latest vitals'), ...errors },
  });
  path({
    method: 'get',
    path: '/api/alerts',
    tags: ['Vitals'],
    summary: 'Vital-sign alerts in scope (health worker: own villages; patient: own)',
    security: secured,
    request: { query: S.ListAlertsQuerySchema },
    responses: { 200: json(S.AlertListSchema, 'Alerts'), ...errors },
  });
  path({
    method: 'patch',
    path: '/api/alerts/{id}',
    tags: ['Vitals'],
    summary: 'Acknowledge an alert (health worker of that village, or doctor)',
    security: secured,
    request: { params: S.IdParamsSchema, ...body(S.AcknowledgeAlertBodySchema) },
    responses: {
      200: json(S.AlertSchema, 'Acknowledged'),
      ...errors,
      404: json(S.ErrorSchema, 'Not found'),
      409: json(S.ErrorSchema, 'Already acknowledged'),
    },
  });

  // ── Dashboard ──
  path({
    method: 'get',
    path: '/api/dashboard/stats',
    tags: ['Dashboard'],
    summary: 'Counts by triage level, village and time (health worker: own villages)',
    security: secured,
    request: { query: S.StatsQuerySchema },
    responses: { 200: json(S.StatsResponseSchema, 'Statistics'), ...errors },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'RuralCare API',
      version: '0.2.0',
      description:
        'Offline-first symptom triage for rural patients. **Triage guidance, not a diagnosis.** ' +
        'Red-flag symptoms always return EMERGENCY (call 108) from a deterministic rule engine.',
    },
    servers: [{ url: '/' }],
  });
}
