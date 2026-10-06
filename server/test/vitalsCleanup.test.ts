import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { deleteOrphanVitals, findOrphanVitals } from '../src/vitals/cleanup';
import { VitalsStore } from '../src/vitals/store';
import { hasDocker, minutesAgo, randomObjectId } from './helpers';

// Its own database in the shared TimescaleDB container: deleting "orphans" here must not touch the
// rows other test files are using at the same time.
let store: VitalsStore;
let admin: pg.Client;
const dbName = `cleanup_${randomUUID().slice(0, 8)}`;

describe.skipIf(!hasDocker())('orphaned vitals cleanup', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: inject('tsdbUrl') });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(inject('tsdbUrl'));
    url.pathname = `/${dbName}`;
    store = VitalsStore.connect(url.toString());
    await store.migrate();
  });
  afterAll(async () => {
    await store?.close();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('dry run counts rows of unknown patients only; delete removes exactly those, also from the aggregate', async () => {
    const kept = randomObjectId();
    const gone = [randomObjectId(), randomObjectId()];
    for (let i = 0; i < 5; i++)
      await store.insert({ time: minutesAgo(i + 1), patientId: kept, deviceId: 'k', spo2: 97 });
    for (const [n, id] of gone.entries())
      for (let i = 0; i < 3; i++)
        await store.insert({ time: minutesAgo(i + 1), patientId: id, deviceId: `g${n}`, spo2: 95 });
    await store.pool.query(`CALL refresh_continuous_aggregate('vitals_hourly', NULL, NULL)`);

    const dry = await findOrphanVitals(store.pool, [kept]);
    expect(dry.rows).toBe(6);
    expect(dry.patients.map((p) => p.patientId).sort()).toEqual([...gone].sort());
    const count = async () => Number((await store.pool.query('SELECT count(*) FROM vitals')).rows[0].count);
    expect(await count()).toBe(11); // the dry run deleted nothing

    expect(await deleteOrphanVitals(store.pool, [kept])).toBe(6);
    expect(await count()).toBe(5);
    const { rows } = await store.pool.query(
      `SELECT DISTINCT patient_id FROM vitals_hourly WHERE patient_id = ANY($1::text[])`,
      [gone],
    );
    expect(rows).toEqual([]);

    // re-running is harmless
    expect((await findOrphanVitals(store.pool, [kept])).rows).toBe(0);
    expect(await deleteOrphanVitals(store.pool, [kept])).toBe(0);
  });
});
