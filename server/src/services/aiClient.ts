import { type ModelOutcome, TRIAGE_LEVELS, type TriageContext } from '@ruralcare/shared';
import { z } from 'zod';

/**
 * Response of POST {AI_SERVICE_URL}/predict (ai-service/app/main.py). Extra fields (condition
 * names/advice) are dropped here: the server rebuilds them from /shared.
 *
 * Only red-flag rules may say EMERGENCY. An EMERGENCY *with* the AI service's matched red flags is
 * accepted (its rules ran as defence in depth); an EMERGENCY without them, or any other malformed
 * payload, is treated as "model unavailable".
 */
export const PredictionResponseSchema = z
  .object({
    level: z.enum(TRIAGE_LEVELS),
    source: z.enum(['model', 'rule_engine']),
    confidence: z.number().min(0).max(1).nullable(),
    lowConfidence: z.boolean().default(false),
    modelVersion: z.string().min(1),
    topConditions: z.array(z.object({ id: z.string(), probability: z.number().min(0).max(1) })).max(10),
    redFlags: z.array(z.string()).default([]),
  })
  .refine(
    (p) =>
      p.level === 'EMERGENCY'
        ? p.source === 'rule_engine' && p.redFlags.length > 0
        : p.source === 'model' && p.confidence !== null,
    'EMERGENCY must come from red-flag rules; model results need a confidence',
  );

export const ModelVersionSchema = z.object({
  modelVersion: z.string(),
  algorithm: z.string(),
  createdAt: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int(),
  featureCount: z.number().int(),
  classCount: z.number().int(),
});
export type ModelVersion = z.infer<typeof ModelVersionSchema>;

export interface AiClient {
  /** Never throws: any failure becomes { status: 'unavailable', reason }. */
  predict(input: TriageContext): Promise<ModelOutcome>;
  isHealthy(): Promise<boolean>;
  /** null when the AI service or its model is unavailable. */
  modelVersion(): Promise<ModelVersion | null>;
}

export function toModelOutcome(body: unknown): ModelOutcome {
  const parsed = PredictionResponseSchema.safeParse(body);
  if (!parsed.success) return { status: 'unavailable', reason: 'AI service returned an invalid prediction' };
  const p = parsed.data;
  if (p.level === 'EMERGENCY') return { status: 'rules_emergency', redFlags: p.redFlags };
  return {
    status: 'ok',
    prediction: {
      level: p.level,
      confidence: p.confidence ?? 0,
      modelVersion: p.modelVersion,
      topConditions: p.topConditions,
      lowConfidence: p.lowConfidence,
    },
  };
}

export function createHttpAiClient(options: { baseUrl: string; timeoutMs: number }): AiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return {
    async predict(input) {
      try {
        const res = await fetch(`${baseUrl}/predict`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!res.ok) return { status: 'unavailable', reason: `AI service responded with HTTP ${res.status}` };
        return toModelOutcome(await res.json());
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        return {
          status: 'unavailable',
          reason: timedOut ? 'AI service timed out' : 'AI service unreachable',
        };
      }
    },

    async isHealthy() {
      try {
        const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
      } catch {
        return false;
      }
    },

    async modelVersion() {
      try {
        const res = await fetch(`${baseUrl}/model/version`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return null;
        const parsed = ModelVersionSchema.safeParse(await res.json());
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}
