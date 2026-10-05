import { buildGuidance, symptomVocabulary } from '@ruralcare/shared';
import { Router } from 'express';
import { badRequest } from '../lib/httpError';
import { rateLimit } from '../lib/rateLimit';
import { GuestTriageBodySchema } from '../schemas/api';
import type { AiClient } from '../services/aiClient';
import { decisionToResult, evaluateTriage, normalizeInput } from '../services/triageService';

const KNOWN_SYMPTOMS = new Set(symptomVocabulary.symptoms.map((s) => s.id));

/**
 * Triage without an account. Same rules, safety floors and model as POST /api/triage, but nothing
 * is stored: no session, no patient, no log of the symptoms. The result lives only on the device.
 */
export function guestRouter(deps: { ai: AiClient; ratePer10Min: number }) {
  const r = Router();

  r.post('/triage', rateLimit({ windowMs: 10 * 60_000, max: deps.ratePer10Min }), async (req, res) => {
    const { input: raw } = GuestTriageBodySchema.parse(req.body);
    const input = normalizeInput(raw);
    const unknown = input.symptoms.filter((s) => !KNOWN_SYMPTOMS.has(s));
    if (unknown.length) throw badRequest('UNKNOWN_SYMPTOMS', 'Unknown symptom ids', { unknown });

    const result = decisionToResult(await evaluateTriage(input, deps.ai));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ result, guidance: buildGuidance(result, result.model.topConditions), stored: false });
  });

  return r;
}
