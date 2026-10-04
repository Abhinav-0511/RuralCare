import { createApp } from './app';
import { loadEnv } from './config/env';

const env = loadEnv();
const app = createApp(env);

const server = app.listen(env.PORT, () => {
  console.log(`ruralcare-server listening on :${env.PORT} (${env.NODE_ENV})`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
