import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setOnAuthLost, type Tokens, tokenStore, type User } from './api';
import { db } from './db';

const USER_KEY = 'ruralcare.user';

interface AuthState {
  user: User | null;
  login: (phone: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const loadUser = (): User | null => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
};

/** The user is cached locally so the app opens offline after one online login. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (tokenStore.get() ? loadUser() : null));

  const clear = useCallback(() => {
    tokenStore.set(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  useEffect(() => setOnAuthLost(clear), [clear]);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await api<{ user: User; tokens: Tokens }>('/api/auth/login', {
      method: 'POST',
      body: { phone, password },
      auth: false,
    });
    tokenStore.set(res.tokens);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    // Keep unsynced sessions: they belong to the device and sync after the next login.
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await db.patients.clear();
    clear();
  }, [clear]);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
