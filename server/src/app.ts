import { redFlagEngine, symptomVocabulary, triageLevels } from '@ruralcare/shared';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { Env } from './config/env';
import { isDbConnected } from './db';
import { createTokenService } from './lib/tokens';
import { authenticate } from './middleware/auth';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { buildOpenApiDocument } from './openapi';
import { authRouter } from './routes/auth';
import { dashboardRouter } from './routes/dashboard';
import { patientsRouter } from './routes/patients';
import { triageRouter } from './routes/triage';
import { usersRouter } from './routes/users';
import { villagesRouter } from './routes/villages';
import type { AiClient } from './services/aiClient';

const startedAt = Date.now();

export interface AppDeps {
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'CORS_ORIGIN'
    | 'BCRYPT_ROUNDS'
    | 'JWT_ACCESS_SECRET'
    | 'JWT_REFRESH_SECRET'
    | 'JWT_ACCESS_TTL'
    | 'JWT_REFRESH_TTL'
  >;
  ai: AiClient;
}

export function createApp({ env, ai }: AppDeps) {
  const app = express();
  const tokens = createTokenService(env);
  const requireAuth = authenticate(tokens);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/health', async (_req, res) => {
    const db = isDbConnected();
    const aiUp = await ai.isHealthy();
    // 503 only when the database is down; the API still works without the AI service.
    res.status(db ? 200 : 503).json({
      status: db ? 'ok' : 'degraded',
      service: 'ruralcare-server',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      dependencies: { mongodb: db ? 'up' : 'down', aiService: aiUp ? 'up' : 'down' },
      shared: {
        redFlagRulesVersion: redFlagEngine.rulesVersion,
        redFlagRuleCount: redFlagEngine.rules.length,
        safetyFloorCount: redFlagEngine.floors.length,
        symptomVocabularyVersion: symptomVocabulary.version,
        triageLevelsVersion: triageLevels.version,
      },
    });
  });

  const openApiDocument = buildOpenApiDocument();
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { customSiteTitle: 'RuralCare API' }),
  );

  app.use('/api/auth', authRouter({ tokens, env }));
  app.use('/api/villages', villagesRouter({ tokens }));
  app.use('/api/users', requireAuth, usersRouter({ env }));
  app.use('/api/patients', requireAuth, patientsRouter());
  app.use('/api/triage', requireAuth, triageRouter({ ai }));
  app.use('/api/dashboard', requireAuth, dashboardRouter());

  app.use(notFoundHandler);
  app.use(createErrorHandler(env.NODE_ENV === 'production'));

  return app;
}
