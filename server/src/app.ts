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
import { authRouter, type OnboardingConfig } from './routes/auth';
import { alertsRouter } from './routes/alerts';
import { dashboardRouter } from './routes/dashboard';
import { guestRouter } from './routes/guest';
import { modelRouter } from './routes/model';
import { patientsRouter } from './routes/patients';
import { triageRouter } from './routes/triage';
import { usersRouter } from './routes/users';
import { villagesRouter } from './routes/villages';
import { vitalsRouter } from './routes/vitals';
import type { AiClient } from './services/aiClient';
import { createConsoleSms, type SmsSender } from './services/sms';
import type { VitalsStore } from './vitals/store';

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
  /** TimescaleDB vitals store; null/undefined disables vitals (503) and device vitals in triage. */
  vitals?: VitalsStore | null;
  /** MQTT ingestion status for /health. */
  mqttConnected?: () => boolean;
  /** OTP and rate-limit settings; defaults below (OTP not echoed). */
  onboarding?: Partial<OnboardingConfig>;
  /** Outgoing SMS for password-reset codes; defaults to logging them. */
  sms?: SmsSender;
}

const ONBOARDING_DEFAULTS: OnboardingConfig = {
  otpDevEcho: false,
  otpTtlSeconds: 300,
  otpMaxAttempts: 5,
  otpRequestsPerPhonePerHour: 3,
  authRateLimitPer15Min: 20,
  guestTriageRateLimitPer10Min: 30,
};

export function createApp({ env, ai, vitals = null, mqttConnected, onboarding, sms }: AppDeps) {
  const config = { ...ONBOARDING_DEFAULTS, ...onboarding };
  const app = express();
  const tokens = createTokenService(env);
  const requireAuth = authenticate(tokens);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/health', async (_req, res) => {
    const db = isDbConnected();
    const [aiUp, tsdbUp] = await Promise.all([
      ai.isHealthy(),
      vitals ? vitals.ping() : Promise.resolve(null),
    ]);
    // 503 only when the database is down; the API still works without the AI service.
    res.status(db ? 200 : 503).json({
      status: db ? 'ok' : 'degraded',
      service: 'ruralcare-server',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      // Only MongoDB is required; the others degrade gracefully (rules-only triage, no vitals).
      dependencies: {
        mongodb: db ? 'up' : 'down',
        aiService: aiUp ? 'up' : 'down',
        timescaledb: tsdbUp === null ? 'disabled' : tsdbUp ? 'up' : 'down',
        mqtt: mqttConnected ? (mqttConnected() ? 'up' : 'down') : 'disabled',
      },
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

  app.use('/api/auth', authRouter({ tokens, env, config, sms: sms ?? createConsoleSms() }));
  // Public, rate-limited, stores nothing.
  app.use('/api/guest', guestRouter({ ai, ratePer10Min: config.guestTriageRateLimitPer10Min }));
  app.use('/api/villages', villagesRouter({ tokens }));
  app.use('/api/model', modelRouter({ ai }));
  app.use('/api/users', requireAuth, usersRouter({ env }));
  app.use('/api/patients', requireAuth, patientsRouter({ env }));
  app.use('/api/triage', requireAuth, triageRouter({ ai, vitals }));
  app.use('/api/vitals', requireAuth, vitalsRouter({ store: vitals }));
  app.use('/api/alerts', requireAuth, alertsRouter());
  app.use('/api/dashboard', requireAuth, dashboardRouter());

  app.use(notFoundHandler);
  app.use(createErrorHandler(env.NODE_ENV === 'production'));

  return app;
}
