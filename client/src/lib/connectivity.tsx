import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { API_URL } from './config';

const OnlineContext = createContext(true);

/**
 * "Online" = the browser has a network AND the API answers /health. navigator.onLine alone says
 * "online" on a Wi-Fi network with no internet, which is common in villages.
 */
export function ConnectivityProvider({
  children,
  pingMs = 20_000,
}: {
  children: ReactNode;
  pingMs?: number;
}) {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }
      try {
        const res = await fetch(`${API_URL}/health`, {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    void check();
    const offline = () => setOnline(false);
    window.addEventListener('online', check);
    window.addEventListener('offline', offline);
    const timer = setInterval(check, pingMs);
    return () => {
      cancelled = true;
      window.removeEventListener('online', check);
      window.removeEventListener('offline', offline);
      clearInterval(timer);
    };
  }, [pingMs]);

  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>;
}

export const useOnline = () => useContext(OnlineContext);
