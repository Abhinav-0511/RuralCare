import { randomUUID } from 'node:crypto';
import { symptomVocabulary, TRIAGE_LEVELS } from '@ruralcare/shared';
import { Router } from 'express';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/httpError';
import { type AuthUser, currentUser, requireRole } from '../middleware/auth';
import { Patient } from '../models/patient';
import { TriageSession } from '../models/triageSession';
import {
  IdParamsSchema,
  ListSessionsQuerySchema,
  NoteBodySchema,
  ReviewBodySchema,
  SyncBodySchema,
  type SyncItemSchema,
  type SyncResultItemSchema,
  TriageRequestBodySchema,
} from '../schemas/api';
import { canAccessPatient, sessionScope } from '../services/access';
import type { AiClient } from '../services/aiClient';
import { attachRecentVitals } from '../vitals/recent';
import type { VitalsStore } from '../vitals/store';
import {
  decisionToResult,
  evaluateTriage,
  findExistingSession,
  insertSessionIdempotent,
  normalizeInput,
  toSessionResponse,
} from '../services/triageService';

const KNOWN_SYMPTOMS = new Set(symptomVocabulary.symptoms.map((s) => s.id));
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

async function loadAccessiblePatient(user: AuthUser, patientId: string) {
  const patient = await Patient.findById(patientId);
  if (!patient) throw notFound('Patient');
  if (!canAccessPatient(user, patient)) throw forbidden('You cannot triage this patient');
  return patient;
}

function canAccessSession(user: AuthUser, session: { patientId: unknown; villageId: unknown }) {
  return canAccessPatient(user, { _id: session.patientId, villageId: session.villageId });
}

type TriageDeps = { ai: AiClient; vitals?: VitalsStore | null };

export function triageRouter(deps: TriageDeps) {
  const r = Router();

  /** Online triage. Rules first; model only if no red flag; rules-only fallback if the model is down. */
  r.post('/', async (req, res) => {
    const user = currentUser(req);
    const body = TriageRequestBodySchema.parse(req.body);
    const patientId = body.patientId ?? user.patientId;
    if (!patientId) throw badRequest('PATIENT_REQUIRED', 'patientId is required');
    const patient = await loadAccessiblePatient(user, patientId);

    const input = normalizeInput({ ...body.input, sex: body.input.sex ?? patient.sex });
    const unknown = input.symptoms.filter((s) => !KNOWN_SYMPTOMS.has(s));
    if (unknown.length) throw badRequest('UNKNOWN_SYMPTOMS', 'Unknown symptom ids', { unknown });

    const clientId = body.clientId ?? randomUUID();
    const existing = await findExistingSession(clientId, patientId);
    if (existing) {
      res.status(200).json({ ...toSessionResponse(existing), duplicate: true });
      return;
    }

    // Recent device vitals (if any) go into the rules: critical values make it an EMERGENCY.
    const at = new Date();
    const withVitals = await attachRecentVitals(input, patientId, at, deps.vitals);
    const decision = await evaluateTriage(withVitals.input, deps.ai);
    const { session, duplicate } = await insertSessionIdempotent({
      clientId,
      patientId: patient._id,
      villageId: patient.villageId,
      performedBy: new Types.ObjectId(user.id),
      origin: 'online',
      occurredAt: at,
      input: withVitals.input,
      vitalsSource: withVitals.vitalsSource,
      ...(withVitals.vitalsMeasuredAt ? { vitalsMeasuredAt: withVitals.vitalsMeasuredAt } : {}),
      result: decisionToResult(decision),
    });
    res.status(duplicate ? 200 : 201).json({ ...toSessionResponse(session), duplicate });
  });

  /**
   * Upload sessions recorded offline. Idempotent per clientId: re-sending returns "duplicate" and
   * never creates a second record. The server re-evaluates every session and its verdict wins.
   */
  r.post('/sync', async (req, res) => {
    const user = currentUser(req);
    const { sessions } = SyncBodySchema.parse(req.body);

    const results: z.input<typeof SyncResultItemSchema>[] = [];
    // Sequential on purpose: duplicates inside one batch resolve deterministically and the AI
    // service isn't flooded after a long offline period.
    for (const item of sessions) {
      try {
        results.push(await syncOne(user, item, deps));
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        results.push({
          clientId: item.clientId,
          status: 'rejected',
          error: { code: err.code, message: err.message },
        });
      }
    }
    res.json({ results });
  });

  r.get('/', async (req, res) => {
    const user = currentUser(req);
    const q = ListSessionsQuerySchema.parse(req.query);
    const occurredAt = {
      ...(q.from ? { $gte: new Date(q.from) } : {}),
      ...(q.to ? { $lt: new Date(q.to) } : {}),
    };
    const filter = {
      ...(q.villageId ? { villageId: new Types.ObjectId(q.villageId) } : {}),
      ...(q.patientId ? { patientId: new Types.ObjectId(q.patientId) } : {}),
      ...(q.level ? { 'result.level': q.level } : {}),
      ...(q.reviewStatus ? { 'review.status': q.reviewStatus } : {}),
      ...(Object.keys(occurredAt).length ? { occurredAt } : {}),
    };
    // Scope is applied with $and so a query param can never widen it.
    const scoped = { $and: [sessionScope(user), filter] };
    const page = { skip: (q.page - 1) * q.limit, limit: q.limit };
    const [items, total] = await Promise.all([
      q.sort === 'urgency'
        ? // Doctor review queue: EMERGENCY first (TRIAGE_LEVELS is ordered most -> least severe).
          TriageSession.aggregate([
            { $match: scoped },
            { $addFields: { _urgency: { $indexOfArray: [TRIAGE_LEVELS, '$result.level'] } } },
            { $sort: { _urgency: 1, occurredAt: -1 } },
            { $skip: page.skip },
            { $limit: page.limit },
            { $project: { _urgency: 0 } },
          ]).then((docs) => docs.map((d) => TriageSession.hydrate(d)))
        : TriageSession.find(scoped).sort({ occurredAt: -1 }).skip(page.skip).limit(page.limit),
      TriageSession.countDocuments(scoped),
    ]);
    const names = new Map(
      (
        await Patient.find({ _id: { $in: items.map((s) => s.patientId) } })
          .select('name')
          .lean()
      ).map((p) => [String(p._id), p.name]),
    );
    res.json({
      items: items.map((s) => ({ ...s.toJSON(), patientName: names.get(String(s.patientId)) ?? null })),
      page: q.page,
      limit: q.limit,
      total,
    });
  });

  r.get('/:id', async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const session = await TriageSession.findById(id);
    if (!session) throw notFound('Triage session');
    if (!canAccessSession(currentUser(req), session)) throw forbidden();
    res.json(toSessionResponse(session));
  });

  r.post('/:id/notes', requireRole('doctor'), async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const { text } = NoteBodySchema.parse(req.body);
    const session = await TriageSession.findByIdAndUpdate(
      id,
      { $push: { 'review.notes': { doctorId: currentUser(req).id, text, createdAt: new Date() } } },
      { new: true },
    );
    if (!session) throw notFound('Triage session');
    res.status(201).json(toSessionResponse(session));
  });

  r.post('/:id/review', requireRole('doctor'), async (req, res) => {
    const { id } = IdParamsSchema.parse(req.params);
    const { note } = ReviewBodySchema.parse(req.body);
    const doctorId = currentUser(req).id;
    const now = new Date();
    // Conditional update: only one doctor can move a session from pending to reviewed.
    const session = await TriageSession.findOneAndUpdate(
      { _id: id, 'review.status': 'pending' },
      {
        $set: { 'review.status': 'reviewed', 'review.reviewedBy': doctorId, 'review.reviewedAt': now },
        ...(note ? { $push: { 'review.notes': { doctorId, text: note, createdAt: now } } } : {}),
      },
      { new: true },
    );
    if (!session) {
      if (await TriageSession.exists({ _id: id }))
        throw conflict('ALREADY_REVIEWED', 'Session is already reviewed');
      throw notFound('Triage session');
    }
    res.json(toSessionResponse(session));
  });

  return r;
}

async function syncOne(
  user: AuthUser,
  item: z.output<typeof SyncItemSchema>,
  deps: TriageDeps,
): Promise<z.input<typeof SyncResultItemSchema>> {
  const patient = await loadAccessiblePatient(user, item.patientId);

  const existing = await findExistingSession(item.clientId, item.patientId);
  if (existing) {
    return {
      clientId: item.clientId,
      status: 'duplicate',
      sessionId: existing.id,
      level: existing.result.level,
      verdictChanged: existing.verdictChanged,
    };
  }

  // Unknown symptoms are kept (the device may have a newer vocabulary); the engine ignores them.
  const input = normalizeInput({ ...item.input, sex: item.input.sex ?? patient.sex });
  const clientTime = new Date(item.clientCreatedAt);
  const now = new Date();
  // A device clock in the future must not distort statistics.
  const occurredAt = clientTime.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS ? now : clientTime;
  // Device vitals from the 30 minutes before the session was recorded offline.
  const withVitals = await attachRecentVitals(input, item.patientId, occurredAt, deps.vitals);
  const decision = await evaluateTriage(withVitals.input, deps.ai);
  const verdictChanged = item.clientResult !== undefined && item.clientResult.level !== decision.level;

  const { session, duplicate } = await insertSessionIdempotent({
    clientId: item.clientId,
    patientId: patient._id,
    villageId: patient.villageId,
    performedBy: new Types.ObjectId(user.id),
    origin: 'offline_sync',
    occurredAt,
    input: withVitals.input,
    vitalsSource: withVitals.vitalsSource,
    ...(withVitals.vitalsMeasuredAt ? { vitalsMeasuredAt: withVitals.vitalsMeasuredAt } : {}),
    result: decisionToResult(decision),
    ...(item.clientResult ? { clientResult: item.clientResult } : {}),
    verdictChanged,
  });
  return {
    clientId: item.clientId,
    status: duplicate ? 'duplicate' : 'created',
    sessionId: session.id,
    level: session.result.level,
    verdictChanged: session.verdictChanged,
  };
}
