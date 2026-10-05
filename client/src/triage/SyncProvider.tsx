import { liveQuery } from 'dexie';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/connectivity';
import { db } from '../lib/db';
import { SESSION_SAVED_EVENT } from './submit';
import { syncPending } from './sync';

interface SyncState {
  pending: number;
  syncing: boolean;
  /** Sessions whose server verdict differs and that the user hasn't acknowledged yet. */
  differences: number;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncState>({
  pending: 0,
  syncing: false,
  differences: 0,
  syncNow: async () => {},
});

/** Keeps the outbox flowing: on reconnect, after each offline triage, and every 10 s while items wait. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const online = useOnline();
  const { user } = useAuth();
  const [pending, setPending] = useState(0);
  const [differences, setDifferences] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    const sub = liveQuery(async () => ({
      pending: await db.sessions.where('syncStatus').equals('pending').count(),
      differences: await db.sessions.filter((s) => Boolean(s.verdictChanged) && !s.differenceSeen).count(),
    })).subscribe((v) => {
      setPending(v.pending);
      setDifferences(v.differences);
    });
    return () => sub.unsubscribe();
  }, []);

  const syncNow = useCallback(async () => {
    if (running.current || !online || !user) return;
    running.current = true;
    setSyncing(true);
    try {
      // Keep going while there are due items (batches of 50).
      for (let i = 0; i < 20; i++) {
        const r = await syncPending();
        if (!r.sent || r.failed) break;
      }
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [online, user]);

  useEffect(() => {
    void syncNow();
  }, [syncNow]);

  useEffect(() => {
    const handler = () => void syncNow();
    window.addEventListener(SESSION_SAVED_EVENT, handler);
    const timer = setInterval(() => pending > 0 && void syncNow(), 10_000);
    return () => {
      window.removeEventListener(SESSION_SAVED_EVENT, handler);
      clearInterval(timer);
    };
  }, [syncNow, pending]);

  return (
    <SyncContext.Provider value={{ pending, syncing, differences, syncNow }}>{children}</SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
