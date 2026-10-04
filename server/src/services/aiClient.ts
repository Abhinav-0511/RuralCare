import { type ModelOutcome, NON_EMERGENCY_LEVELS, type TriageContext } from '@ruralcare/shared';
import { z } from 'zod';

/**
 * Contract for POST {AI_SERVICE_URL}/predict (implemented in Phase 3).
 * The model may never return EMERGENCY: only red-flag rules can. A response with EMERGENCY,
 * or any other malformed payload, is treated as "model unavailable".
 */
export const PredictionResponseSchema = z.object({
  level: z.enum(NON_EMERGENCY_LEVELS),
  confidence: z.number().min(0).max(1),
  modelVersion: z.string().min(1),
  topConditions: z.array(z.object({ id: z.string(), probability: z.number().min(0).max(1) })).max(10),
});

export interface AiClient {
  /** Never throws: any failure becomes { status: 'unavailable', reason }. */
  predict(input: TriageContext): Promise<ModelOutcome>;
  isHealthy(): Promise<boolean>;
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
        const parsed = PredictionResponseSchema.safeParse(await res.json());
        if (!parsed.success)
          return { status: 'unavailable', reason: 'AI service returned an invalid prediction' };
        return { status: 'ok', prediction: parsed.data };
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
  };
}
