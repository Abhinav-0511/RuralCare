import { liveQuery } from 'dexie';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { useOnline } from './connectivity';
import { type CachedPatient, db } from './db';

/** Subscribes to a Dexie query (re-renders when IndexedDB changes). */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** GET with loading/error state. Pass null to skip (e.g. while offline). */
export function useApi<T>(path: string | null) {
  const [tick, setTick] = useState(0);
  const key = path ? `${path}#${tick}` : null;
  const [result, setResult] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!path || !key) return;
    let cancelled = false;
    api<T>(path)
      .then((data) => !cancelled && setResult({ key, data, error: null }))
      .catch((err: Error) => !cancelled && setResult((r) => ({ key, data: r.data, error: err.message })));
    return () => {
      cancelled = true;
    };
  }, [path, key]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  // Keep showing the previous data while reloading (no flicker after an action).
  return { data: result.data, error: result.error, loading: key !== null && result.key !== key, reload };
}

interface PatientDto {
  id: string;
  name: string;
  sex: 'female' | 'male' | 'other';
  dateOfBirth: string;
  ageMonths: number;
  villageId: string;
}

const toCached = (p: PatientDto): CachedPatient => ({
  id: p.id,
  name: p.name,
  sex: p.sex,
  dateOfBirth: p.dateOfBirth,
  ageMonths: p.ageMonths,
  villageId: p.villageId,
});

/** Patients in scope, cached in IndexedDB so the triage wizard works offline. */
export function usePatients(): CachedPatient[] {
  const online = useOnline();
  const { user } = useAuth();

  useEffect(() => {
    if (!online || !user) return;
    let cancelled = false;
    (async () => {
      const list: PatientDto[] = [];
      if (user.role === 'patient') {
        if (user.patientId) list.push(await api<PatientDto>(`/api/patients/${user.patientId}`));
      } else {
        for (let page = 1; page <= 20; page++) {
          const res = await api<{ items: PatientDto[]; total: number }>(
            `/api/patients?limit=100&page=${page}`,
          );
          list.push(...res.items);
          if (list.length >= res.total) break;
        }
      }
      if (cancelled) return;
      await db.transaction('rw', db.patients, async () => {
        await db.patients.clear();
        await db.patients.bulkPut(list.map(toCached));
      });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [online, user]);

  return useLiveQuery(() => db.patients.orderBy('name').toArray(), [], [] as CachedPatient[]);
}
