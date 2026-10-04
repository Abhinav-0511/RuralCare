import { redFlagEngine, symptomVocabulary, triageLevels } from '@ruralcare/shared';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env';

const startedAt = Date.now();

export function createApp(env: Pick<Env, 'CORS_ORIGIN' | 'NODE_ENV'>) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ruralcare-server',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      shared: {
        redFlagRulesVersion: redFlagEngine.rulesVersion,
        redFlagRuleCount: redFlagEngine.rules.length,
        symptomVocabularyVersion: symptomVocabulary.version,
        triageLevelsVersion: triageLevels.version,
      },
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message:
          status >= 500 && env.NODE_ENV === 'production' ? 'Internal server error' : String(err?.message),
      },
    });
  };
  app.use(errorHandler);

  return app;
}
