// Usage: npm run seed -w @ruralcare/server          (local, reads server/.env)
//        docker compose -f infra/docker-compose.yml exec server node server/dist/seed.js
// WIPES villages, users, patients and triage sessions, then inserts demo data.
import mongoose from 'mongoose';
import { loadEnv } from '../config/env';
import { connectDb } from '../db';
import { DEMO_PASSWORD, seedDemoData } from '../services/seed';

const env = loadEnv();
if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to wipe and seed a production database. Re-run with --force if you are sure.');
  process.exit(1);
}

await connectDb(env.MONGO_URI);
const summary = await seedDemoData({ bcryptRounds: env.BCRYPT_ROUNDS });
await mongoose.disconnect();

console.log(
  `Seeded ${summary.villages} villages, ${summary.users} users, ${summary.patients} patients, ${summary.sessions} triage sessions.`,
);
console.log(`\nDemo logins (password for all: ${DEMO_PASSWORD})`);
console.table(summary.credentials);
