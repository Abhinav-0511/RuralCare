import type pg from 'pg';

export interface OrphanSummary {
  rows: number;
  patients: { patientId: string; rows: number; from: Date; to: Date }[];
  from: Date | null;
  to: Date | null;
}

/**
 * Vitals rows whose patient no longer exists in MongoDB (e.g. after a re-seed, which replaces all
 * patients). Nothing shows them; they only take space and skew nothing but storage.
 */
export async function findOrphanVitals(pool: pg.Pool, knownPatientIds: string[]): Promise<OrphanSummary> {
  const { rows } = await pool.query<{ patient_id: string; rows: string; from: Date; to: Date }>(
    `SELECT patient_id, count(*) AS rows, min(time) AS "from", max(time) AS "to"
       FROM vitals WHERE patient_id <> ALL($1::text[])
      GROUP BY patient_id ORDER BY min(time)`,
    [knownPatientIds],
  );
  const patients = rows.map((r) => ({
    patientId: r.patient_id,
    rows: Number(r.rows),
    from: r.from,
    to: r.to,
  }));
  return {
    rows: patients.reduce((n, p) => n + p.rows, 0),
    patients,
    from: patients.length ? new Date(Math.min(...patients.map((p) => p.from.getTime()))) : null,
    to: patients.length ? new Date(Math.max(...patients.map((p) => p.to.getTime()))) : null,
  };
}

/**
 * Deletes the orphaned rows and re-materialises the hourly aggregate over that time range, so the
 * deleted readings disappear from `vitals_hourly` too. Returns the number of rows deleted.
 */
export async function deleteOrphanVitals(pool: pg.Pool, knownPatientIds: string[]): Promise<number> {
  const summary = await findOrphanVitals(pool, knownPatientIds);
  if (!summary.rows) return 0;
  const res = await pool.query(`DELETE FROM vitals WHERE patient_id <> ALL($1::text[])`, [knownPatientIds]);
  const hour = 3_600_000;
  const from = new Date(Math.floor(summary.from!.getTime() / hour) * hour);
  const to = new Date(Math.ceil((summary.to!.getTime() + 1) / hour) * hour);
  await pool.query(`CALL refresh_continuous_aggregate('vitals_hourly', $1::timestamptz, $2::timestamptz)`, [
    from,
    to,
  ]);
  return res.rowCount ?? 0;
}
