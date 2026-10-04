import { Router } from 'express';
import { HttpError } from '../lib/httpError';
import type { AiClient } from '../services/aiClient';

/** Public: the PWA compares `sha256` with its cached model to decide whether to download a new one. */
export function modelRouter(deps: { ai: AiClient }) {
  const r = Router();

  r.get('/version', async (_req, res) => {
    const version = await deps.ai.modelVersion();
    if (!version) throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The AI service or its model is unavailable');
    res.set('Cache-Control', 'no-cache').json(version);
  });

  return r;
}
