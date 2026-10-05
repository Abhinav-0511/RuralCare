import mongoose from 'mongoose';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { connectDb } from './db';
import { createHttpAiClient } from './services/aiClient';
import { ensureAdmin } from './services/bootstrap';
import { createVitalsHandler, type MqttIngestor, startMqttIngestor } from './vitals/ingest';
import { VitalsStore } from './vitals/store';

const env = loadEnv();
await connectDb(env.MONGO_URI);
await ensureAdmin(env);

const ai = createHttpAiClient({ baseUrl: env.AI_SERVICE_URL, timeoutMs: env.AI_SERVICE_TIMEOUT_MS });

// Vitals are optional: without TimescaleDB the API still serves triage (without device vitals).
let vitals: VitalsStore | null = null;
let ingestor: MqttIngestor | null = null;
if (env.TSDB_URL) {
  vitals = VitalsStore.connect(env.TSDB_URL, env.VITALS_RAW_RETENTION_DAYS);
  try {
    await vitals.migrate();
  } catch (err) {
    console.error('TimescaleDB migration failed; vitals disabled', err);
    await vitals.close();
    vitals = null;
  }
}
if (vitals && env.MQTT_URL) {
  ingestor = startMqttIngestor({
    url: env.MQTT_URL,
    username: env.MQTT_USERNAME,
    ...(env.MQTT_PASSWORD ? { password: env.MQTT_PASSWORD } : {}),
    topicPrefix: env.MQTT_TOPIC_PREFIX,
    handler: createVitalsHandler({ store: vitals, topicPrefix: env.MQTT_TOPIC_PREFIX }),
  });
}

const app = createApp({ env, ai, vitals, ...(ingestor ? { mqttConnected: ingestor.isConnected } : {}) });

const server = app.listen(env.PORT, () => {
  console.log(`ruralcare-server listening on :${env.PORT} (${env.NODE_ENV}), API docs at /api/docs`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void Promise.allSettled([mongoose.disconnect(), ingestor?.stop(), vitals?.close()]).finally(() =>
      process.exit(0),
    );
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
