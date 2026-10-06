// Removes TimescaleDB vitals rows for patient ids that no longer exist in MongoDB.
// Dry run by default (prints what would be deleted); --apply deletes. Safe to re-run.
// Usage: npm run vitals:cleanup -w @ruralcare/server [-- --apply]          (local, reads server/.env)
//        docker compose -f infra/docker-compose.yml exec server node server/dist/cleanupOrphanVitals.js [--apply]
import mongoose from 'mongoose';
import { loadEnv } from '../config/env';
import { connectDb } from '../db';
import { Patient } from '../models/patient';
import { deleteOrphanVitals, findOrphanVitals } from '../vitals/cleanup';
import { VitalsStore } from '../vitals/store';

const env = loadEnv();
const apply = process.argv.includes('--apply');
if (!env.TSDB_URL) {
  console.error('TSDB_URL is not set: nothing to clean.');
  process.exit(1);
}

await connectDb(env.MONGO_URI);
const store = VitalsStore.connect(env.TSDB_URL);
try {
  const known = (await Patient.distinct('_id')).map(String);
  // An empty patient list would make every row an "orphan": most likely the wrong database.
  if (known.length === 0 && !process.argv.includes('--allow-empty')) {
    console.error('MongoDB has no patients. Refusing to treat all vitals as orphaned (use --allow-empty).');
    process.exitCode = 1;
  } else {
    const summary = await findOrphanVitals(store.pool, known);
    console.log(`Known patients: ${known.length}`);
    console.log(
      `Orphaned vitals rows: ${summary.rows} for ${summary.patients.length} missing patient ids` +
        (summary.rows ? ` (${summary.from!.toISOString()} to ${summary.to!.toISOString()})` : ''),
    );
    if (!summary.rows) {
      console.log('Nothing to do.');
    } else if (!apply) {
      console.log('Dry run: nothing deleted. Re-run with --apply to delete these rows.');
    } else {
      const deleted = await deleteOrphanVitals(store.pool, known);
      console.log(`Deleted ${deleted} rows and refreshed vitals_hourly for that period.`);
    }
  }
} finally {
  await store.close();
  await mongoose.disconnect();
}
