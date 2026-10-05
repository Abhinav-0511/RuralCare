// Usage: npm run devices:provision -w @ruralcare/server     (reads server/.env)
// Re-generates MQTT credentials for every active device. The seed already does this; use this
// script after adding or changing devices. Mosquitto and the simulator pick up the change by themselves.
import mongoose from 'mongoose';
import { loadEnv } from '../config/env';
import { connectDb } from '../db';
import { provisionDevices } from '../services/provision';

const env = loadEnv();
await connectDb(env.MONGO_URI);
try {
  const result = await provisionDevices(env);
  console.log(`Provisioned ${result.devices.length} devices:`);
  console.table(result.devices);
  console.log(`Wrote ${result.files.join(', ')}`);
  console.log('Mosquitto reloads the new credentials within a few seconds; the simulator reconnects.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
