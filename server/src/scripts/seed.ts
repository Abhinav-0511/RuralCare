// Usage: npm run seed -w @ruralcare/server          (local, reads server/.env)
//        docker compose -f infra/docker-compose.yml exec server node server/dist/seed.js
// WIPES villages, users, patients and triage sessions, then inserts demo data.
// Sessions are triaged by the real model, so the AI service must be running; pass --allow-fallback to
// seed anyway (non-emergency sessions then get the rules-only fallback result).
import mongoose from 'mongoose';
import { loadEnv } from '../config/env';
import { connectDb } from '../db';
import { createHttpAiClient } from '../services/aiClient';
import { DEMO_PASSWORD, seedDemoData } from '../services/seed';

const env = loadEnv();
if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to wipe and seed a production database. Re-run with --force if you are sure.');
  process.exit(1);
}

const ai = createHttpAiClient({ baseUrl: env.AI_SERVICE_URL, timeoutMs: env.AI_SERVICE_TIMEOUT_MS });
const probe = await ai.predict({ symptoms: ['cough'], ageMonths: 360 });
if (probe.status !== 'ok' && !process.argv.includes('--allow-fallback')) {
  console.error(
    `The AI service at ${env.AI_SERVICE_URL} is not answering ` +
      `(${probe.status === 'unavailable' ? probe.reason : probe.status}).\n` +
      'Start it first, or re-run with --allow-fallback to seed with rules-only results.',
  );
  process.exit(1);
}
const version = await ai.modelVersion();

await connectDb(env.MONGO_URI);
const summary = await seedDemoData({ bcryptRounds: env.BCRYPT_ROUNDS, ai });
await mongoose.disconnect();

console.log(
  `Seeded ${summary.villages} villages, ${summary.users} users, ${summary.patients} patients, ${summary.sessions} triage sessions.`,
);
console.log(`Model: ${version?.modelVersion ?? 'unavailable (rules-only fallback)'}`);
console.log(`\nDemo logins (password for all: ${DEMO_PASSWORD})`);
console.table(summary.credentials);
console.log(
  '\nVitals devices (next: npm run devices:provision -w @ruralcare/server, then restart mosquitto):',
);
console.table(summary.devices);
