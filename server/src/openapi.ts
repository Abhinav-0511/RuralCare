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
    summary: 'Patient self-registration',
    request: body(S.RegisterBodySchema),
    responses: {
      201: json(S.AuthResponseSchema, 'Registered'),
      400: errors[400],
      409: json(S.ErrorSchema, 'Phone already registered'),
    },
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
    responses: { 201: json(S.UserSchema, 'Created'), ...errors, 409: json(S.ErrorSchema, 'Phone taken') },
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
    summary: 'Register a patient (health worker, admin)',
    security: secured,
    request: body(S.CreatePatientBodySchema),
    responses: { 201: json(S.PatientSchema, 'Created'), ...errors },
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
