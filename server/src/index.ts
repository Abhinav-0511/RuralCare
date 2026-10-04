import mongoose from 'mongoose';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { connectDb } from './db';
import { createHttpAiClient } from './services/aiClient';
import { ensureAdmin } from './services/bootstrap';

const env = loadEnv();
await connectDb(env.MONGO_URI);
await ensureAdmin(env);

const ai = createHttpAiClient({ baseUrl: env.AI_SERVICE_URL, timeoutMs: env.AI_SERVICE_TIMEOUT_MS });
const app = createApp({ env, ai });

const server = app.listen(env.PORT, () => {
  console.log(`ruralcare-server listening on :${env.PORT} (${env.NODE_ENV}), API docs at /api/docs`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void mongoose.disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
