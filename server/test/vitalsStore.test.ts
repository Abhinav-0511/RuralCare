import { describe, expect, it } from 'vitest';
import { hasDocker, minutesAgo, randomObjectId, useVitalsStore } from './helpers';

const store = useVitalsStore();

describe.skipIf(!hasDocker())('TimescaleDB schema', () => {
  it('migration is idempotent', async () => {
    await store().migrate();
    await store().migrate();
  });

  it('vitals is a hypertable with an hourly continuous aggregate (real-time enabled)', async () => {
    const { rows: ht } = await store().pool.query(
      `SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'vitals'`,
    );
    expect(ht).toHaveLength(1);
    const { rows: ca } = await store().pool.query(
      `SELECT view_name, materialized_only FROM timescaledb_information.continuous_aggregates`,
    );
    expect(ca).toEqual([{ view_name: 'vitals_hourly', materialized_only: false }]);
  });

  it('has a 30-day retention policy on raw data, 1 year on the aggregate, and a refresh policy', async () => {
    const { rows } = await store().pool.query(
      `SELECT proc_name, hypertable_name, config FROM timescaledb_information.jobs WHERE application_name NOT LIKE '%Telemetry%'`,
    );
    const retention = rows.filter((r) => r.proc_name === 'policy_retention');
    expect(retention.find((r) => r.hypertable_name === 'vitals')?.config.drop_after).toBe('30 days');
    expect(retention.find((r) => r.hypertable_name !== 'vitals')?.config.drop_after).toBe('365 days');
    expect(rows.some((r) => r.proc_name === 'policy_refresh_continuous_aggregate')).toBe(true);
  });
});

describe.skipIf(!hasDocker())('VitalsStore', () => {
  it('ignores a redelivered reading (same device + timestamp)', async () => {
    const row = { time: minutesAgo(1), patientId: randomObjectId(), deviceId: 'dev-dup', spo2: 97 };
    expect(await store().insert(row)).toBe(true);
    expect(await store().insert(row)).toBe(false);
  });

  it('latest() returns the newest value of each vital inside the window', async () => {
    const patientId = randomObjectId();
    await store().insert({ time: minutesAgo(50), patientId, deviceId: 'd1', spo2: 80 }); // outside 30 min
    await store().insert({ time: minutesAgo(20), patientId, deviceId: 'd1', spo2: 95, heartRate: 70 });
    await store().insert({ time: minutesAgo(5), patientId, deviceId: 'd1', spo2: 93, temperatureC: 38.4 });

    const latest = await store().latest(patientId, minutesAgo(30), new Date());
    expect(latest).toMatchObject({ spo2: 93, heartRate: 70, temperatureC: 38.4 });
    expect(latest!.measuredAt.getTime()).toBeGreaterThan(minutesAgo(6).getTime());
    expect(await store().latest(patientId, minutesAgo(10), minutesAgo(6))).toBeNull();
  });

  it('series() averages raw readings per time_bucket', async () => {
    const patientId = randomObjectId();
    const base = new Date('2026-09-01T10:00:00Z');
    const at = (sec: number) => new Date(base.getTime() + sec * 1000);
    await store().insert({ time: at(0), patientId, deviceId: 'd', heartRate: 70, spo2: 96 });
    await store().insert({ time: at(30), patientId, deviceId: 'd', heartRate: 80, spo2: 94 });
    await store().insert({ time: at(70), patientId, deviceId: 'd', heartRate: 100, spo2: 90 });

    const points = await store().series(patientId, base, at(120), '1m');
    expect(points).toEqual([
      expect.objectContaining({
        time: '2026-09-01T10:00:00.000Z',
        heartRate: 75,
        spo2: 95,
        minSpo2: 94,
        readings: 2,
      }),
      expect.objectContaining({
        time: '2026-09-01T10:01:00.000Z',
        heartRate: 100,
        maxHeartRate: 100,
        readings: 1,
      }),
    ]);
  });

  it('series() with 1h/1d buckets reads the continuous aggregate (reading-weighted daily average)', async () => {
    const patientId = randomObjectId();
    const h = (hour: number, min = 0) => new Date(Date.UTC(2026, 8, 2, hour, min));
    await store().insert({ time: h(8, 0), patientId, deviceId: 'd', heartRate: 60 });
    await store().insert({ time: h(8, 30), patientId, deviceId: 'd', heartRate: 80 });
    await store().insert({ time: h(9, 15), patientId, deviceId: 'd', heartRate: 100, temperatureC: 39.6 });
    await store().pool.query(
      `CALL refresh_continuous_aggregate('vitals_hourly', $1::timestamptz, $2::timestamptz)`,
      [h(0), h(23)],
    );

    const hourly = await store().series(patientId, h(0), h(23), '1h');
    expect(hourly.map((p) => [p.time, p.heartRate, p.readings])).toEqual([
      ['2026-09-02T08:00:00.000Z', 70, 2],
      ['2026-09-02T09:00:00.000Z', 100, 1],
    ]);
    const daily = await store().series(patientId, h(0), h(23), '1d');
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ heartRate: 80, readings: 3, maxTemperatureC: 39.6 }); // (60+80+100)/3
  });
});

describe.skipIf(!hasDocker())('VitalsStore.extremes', () => {
  it('returns latest, min and max per vital', async () => {
    const patientId = randomObjectId();
    await store().insert({ time: minutesAgo(9), patientId, deviceId: 'd', spo2: 86, heartRate: 90 });
    await store().insert({ time: minutesAgo(2), patientId, deviceId: 'd', spo2: 97 });
    const ex = await store().extremes(patientId, minutesAgo(30), new Date());
    expect(ex!.values).toEqual({
      spo2: { last: 97, min: 86, max: 97 },
      heartRate: { last: 90, min: 90, max: 90 },
    });
  });
});
