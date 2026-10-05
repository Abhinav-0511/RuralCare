import { compose } from './helpers';

/** Fresh demo data for every run. The seed also rotates MQTT credentials; the simulator reconnects. */
export default async function globalSetup() {
  const out = compose('exec -T server node server/dist/seed.js');
  if (!out.includes('Seeded')) throw new Error(`Seed failed:\n${out}`);
  // Let Mosquitto reload and the simulator reconnect with the new credentials.
  await new Promise((r) => setTimeout(r, 12_000));
}
