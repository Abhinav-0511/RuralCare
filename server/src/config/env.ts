import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    MONGO_URI: z.string().min(1),

    AI_SERVICE_URL: z.url().default('http://localhost:8000'),
    AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

    // Vitals (Phase 4). Without TSDB_URL the vitals/alerts features are disabled (endpoints answer 503)
    // and triage runs without device vitals; without MQTT_URL no readings are ingested.
    TSDB_URL: z.string().optional(),
    VITALS_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    MQTT_URL: z.string().optional(),
    MQTT_USERNAME: z.string().default('ruralcare-server'),
    MQTT_PASSWORD: z.string().optional(),
    MQTT_TOPIC_PREFIX: z
      .string()
      .regex(/^[a-z0-9_/-]+$/)
      .default('ruralcare/vitals'),
    // Where `npm run devices:provision` writes Mosquitto's passwd/acl and the simulator's device list.
    MQTT_PROVISION_DIR: z.string().default('../infra/mosquitto/generated'),
    SIMULATOR_DEVICES_FILE: z.string().default('../infra/mosquitto/generated/devices.json'),

    // Optional: create this admin on startup if no admin exists yet
    SEED_ADMIN_PHONE: z.string().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
    SEED_ADMIN_NAME: z.string().default('RuralCare Admin'),
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine(
    (e) =>
      e.NODE_ENV !== 'production' ||
      ![e.JWT_ACCESS_SECRET, e.JWT_REFRESH_SECRET].some((s) => s.includes('change_me')),
    { message: 'Replace the example JWT secrets before running in production', path: ['JWT_ACCESS_SECRET'] },
  );

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
