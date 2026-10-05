// TimescaleDB access for device vitals: hypertable, hourly continuous aggregate, retention policies.
import type { VitalReading } from '@ruralcare/shared';
import pg from 'pg';

export interface VitalRow extends VitalReading {
  time: Date;
  patientId: string;
  deviceId: string;
}

export const BUCKETS = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '1d': '1 day',
} as const;
export type Bucket = keyof typeof BUCKETS;

export interface SeriesPoint {
  time: string;
  heartRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  minSpo2: number | null;
  maxHeartRate: number | null;
  maxTemperatureC: number | null;
  readings: number;
}

export interface LatestVitals extends VitalReading {
  /** Time of the newest reading in the window. */
  measuredAt: Date;
}

/** Latest, lowest and highest value of each vital in a window. */
export interface VitalExtremes {
  measuredAt: Date;
  values: Partial<Record<keyof VitalReading, { last: number; min: number; max: number }>>;
}

const VITAL_COLUMNS = {
  heartRate: 'heart_rate',
  spo2: 'spo2',
  temperatureC: 'temperature_c',
  systolicBp: 'systolic_bp',
  diastolicBp: 'diastolic_bp',
} as const;

/** Idempotent schema setup. Safe to run on every start. */
export const migrationSql = (rawRetentionDays: number) => [
  `CREATE EXTENSION IF NOT EXISTS timescaledb`,
  `CREATE TABLE IF NOT EXISTS vitals (
     time          timestamptz NOT NULL,
     patient_id    text        NOT NULL,
     device_id     text        NOT NULL,
     heart_rate    smallint,
     spo2          smallint,
     temperature_c real,
     systolic_bp   smallint,
     diastolic_bp  smallint,
     received_at   timestamptz NOT NULL DEFAULT now()
   )`,
  // 1-day chunks: queries for "last 30 minutes" or "last 24 hours" touch one or two chunks.
  `SELECT create_hypertable('vitals', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE)`,
  // MQTT QoS 1 may redeliver a message: (device, time) identifies a reading.
  `CREATE UNIQUE INDEX IF NOT EXISTS vitals_device_time_uq ON vitals (device_id, time)`,
  `CREATE INDEX IF NOT EXISTS vitals_patient_time_idx ON vitals (patient_id, time DESC)`,
  // Hourly averages, kept up to date by a background policy. materialized_only = false adds
  // not-yet-materialised recent data at query time ("real-time aggregation").
  `CREATE MATERIALIZED VIEW IF NOT EXISTS vitals_hourly
     WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
   SELECT patient_id,
          time_bucket(INTERVAL '1 hour', time) AS bucket,
          avg(heart_rate)::real    AS heart_rate,
          avg(spo2)::real          AS spo2,
          avg(temperature_c)::real AS temperature_c,
          avg(systolic_bp)::real   AS systolic_bp,
          avg(diastolic_bp)::real  AS diastolic_bp,
          min(spo2)                AS min_spo2,
          max(heart_rate)          AS max_heart_rate,
          max(temperature_c)       AS max_temperature_c,
          count(*)                 AS readings
   FROM vitals
   GROUP BY patient_id, bucket
   WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('vitals_hourly',
     start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
     schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE)`,
  // Raw readings are dropped after N days; hourly averages are kept for a year.
  `SELECT add_retention_policy('vitals', drop_after => INTERVAL '${rawRetentionDays} days', if_not_exists => TRUE)`,
  `SELECT add_retention_policy('vitals_hourly', drop_after => INTERVAL '365 days', if_not_exists => TRUE)`,
];

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

export class VitalsStore {
  constructor(
    readonly pool: pg.Pool,
    private readonly rawRetentionDays = 30,
  ) {}

  static connect(url: string, rawRetentionDays = 30) {
    return new VitalsStore(new pg.Pool({ connectionString: url, max: 5 }), rawRetentionDays);
  }

  async migrate(): Promise<void> {
    for (const sql of migrationSql(this.rawRetentionDays)) await this.pool.query(sql);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** Returns false when the reading is a duplicate (same device and timestamp). */
  async insert(row: VitalRow): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO vitals (time, patient_id, device_id, heart_rate, spo2, temperature_c, systolic_bp, diastolic_bp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (device_id, time) DO NOTHING`,
      [
        row.time,
        row.patientId,
        row.deviceId,
        row.heartRate ?? null,
        row.spo2 ?? null,
        row.temperatureC ?? null,
        row.systolicBp ?? null,
        row.diastolicBp ?? null,
      ],
    );
    return res.rowCount === 1;
  }

  /** Newest value of each vital in [from, to], or null if there is no reading at all. */
  async latest(patientId: string, from: Date, to: Date): Promise<LatestVitals | null> {
    const { rows } = await this.pool.query(
      `SELECT max(time) AS measured_at,
              last(heart_rate, time)    FILTER (WHERE heart_rate IS NOT NULL)    AS heart_rate,
              last(spo2, time)          FILTER (WHERE spo2 IS NOT NULL)          AS spo2,
              last(temperature_c, time) FILTER (WHERE temperature_c IS NOT NULL) AS temperature_c,
              last(systolic_bp, time)   FILTER (WHERE systolic_bp IS NOT NULL)   AS systolic_bp,
              last(diastolic_bp, time)  FILTER (WHERE diastolic_bp IS NOT NULL)  AS diastolic_bp
       FROM vitals WHERE patient_id = $1 AND time >= $2 AND time <= $3`,
      [patientId, from, to],
    );
    const r = rows[0];
    if (!r?.measured_at) return null;
    const out: LatestVitals = { measuredAt: r.measured_at };
    if (r.heart_rate !== null) out.heartRate = Number(r.heart_rate);
    if (r.spo2 !== null) out.spo2 = Number(r.spo2);
    if (r.temperature_c !== null) out.temperatureC = num(r.temperature_c)!;
    if (r.systolic_bp !== null) out.systolicBp = Number(r.systolic_bp);
    if (r.diastolic_bp !== null) out.diastolicBp = Number(r.diastolic_bp);
    return out;
  }

  /** For triage: per vital, the latest value plus the extremes, so a brief critical reading isn't lost. */
  async extremes(patientId: string, from: Date, to: Date): Promise<VitalExtremes | null> {
    const select = Object.values(VITAL_COLUMNS)
      .map(
        (c) =>
          `last(${c}, time) FILTER (WHERE ${c} IS NOT NULL) AS ${c}_last, min(${c}) AS ${c}_min, max(${c}) AS ${c}_max`,
      )
      .join(', ');
    const { rows } = await this.pool.query(
      `SELECT max(time) AS measured_at, ${select} FROM vitals WHERE patient_id = $1 AND time >= $2 AND time <= $3`,
      [patientId, from, to],
    );
    const r = rows[0];
    if (!r?.measured_at) return null;
    const values: VitalExtremes['values'] = {};
    for (const [key, col] of Object.entries(VITAL_COLUMNS) as [keyof VitalReading, string][]) {
      if (r[`${col}_last`] === null) continue;
      values[key] = { last: num(r[`${col}_last`])!, min: num(r[`${col}_min`])!, max: num(r[`${col}_max`])! };
    }
    return { measuredAt: r.measured_at, values };
  }

  /**
   * time_bucket() series. Minute buckets read raw readings; hourly/daily buckets read the
   * vitals_hourly continuous aggregate (daily = reading-weighted average of the hours).
   */
  async series(patientId: string, from: Date, to: Date, bucket: Bucket): Promise<SeriesPoint[]> {
    let sql: string;
    if (bucket === '1h' || bucket === '1d') {
      sql = `SELECT time_bucket($4::interval, bucket) AS t,
                    sum(heart_rate * readings) / nullif(sum(readings) FILTER (WHERE heart_rate IS NOT NULL), 0) AS heart_rate,
                    sum(spo2 * readings) / nullif(sum(readings) FILTER (WHERE spo2 IS NOT NULL), 0) AS spo2,
                    sum(temperature_c * readings) / nullif(sum(readings) FILTER (WHERE temperature_c IS NOT NULL), 0) AS temperature_c,
                    sum(systolic_bp * readings) / nullif(sum(readings) FILTER (WHERE systolic_bp IS NOT NULL), 0) AS systolic_bp,
                    sum(diastolic_bp * readings) / nullif(sum(readings) FILTER (WHERE diastolic_bp IS NOT NULL), 0) AS diastolic_bp,
                    min(min_spo2) AS min_spo2, max(max_heart_rate) AS max_heart_rate,
                    max(max_temperature_c) AS max_temperature_c, sum(readings) AS readings
             FROM vitals_hourly
             WHERE patient_id = $1 AND bucket >= time_bucket(INTERVAL '1 hour', $2::timestamptz) AND bucket < $3
             GROUP BY t ORDER BY t`;
    } else {
      sql = `SELECT time_bucket($4::interval, time) AS t,
                    avg(heart_rate) AS heart_rate, avg(spo2) AS spo2, avg(temperature_c) AS temperature_c,
                    avg(systolic_bp) AS systolic_bp, avg(diastolic_bp) AS diastolic_bp,
                    min(spo2) AS min_spo2, max(heart_rate) AS max_heart_rate,
                    max(temperature_c) AS max_temperature_c, count(*) AS readings
             FROM vitals
             WHERE patient_id = $1 AND time >= $2 AND time < $3
             GROUP BY t ORDER BY t`;
    }
    const { rows } = await this.pool.query(sql, [patientId, from, to, BUCKETS[bucket]]);
    return rows.map((r) => ({
      time: new Date(r.t).toISOString(),
      heartRate: num(r.heart_rate),
      spo2: num(r.spo2),
      temperatureC: num(r.temperature_c),
      systolicBp: num(r.systolic_bp),
      diastolicBp: num(r.diastolic_bp),
      minSpo2: num(r.min_spo2),
      maxHeartRate: num(r.max_heart_rate),
      maxTemperatureC: num(r.max_temperature_c),
      readings: Number(r.readings),
    }));
  }

  close() {
    return this.pool.end();
  }
}
