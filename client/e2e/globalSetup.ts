import { compose } from './helpers';

/** Fresh demo data for every run. The seed also rotates MQTT credentials; the simulator reconnects. */
export default async function globalSetup() {
  const out = compose('exec -T server node server/dist/seed.js');
  if (!out.includes('Seeded')) throw new Error(`Seed failed:\n${out}`);
  // Let Mosquitto reload and the simulator reconnect with the new credentials.
  await new Promise((r) => setTimeout(r, 12_000));
  // The seed replaced every patient: remove the vitals of patients that no longer exist (from
  // earlier runs), so they don't build up in TimescaleDB.
  const cleanup = compose('exec -T server node server/dist/cleanupOrphanVitals.js --apply');
  if (!/Deleted \d+ rows|Nothing to do/.test(cleanup)) throw new Error(`Vitals cleanup failed:\n${cleanup}`);
}
