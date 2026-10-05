import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when the server can't be reached (offline, DNS, timeout): callers switch to offline mode. */
export class NetworkError extends Error {}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  role: 'patient' | 'health_worker' | 'doctor' | 'admin';
  villageIds: string[];
  patientId?: string;
  preferredLanguage: 'en' | 'ta' | 'hi';
}

const TOKENS_KEY = 'ruralcare.tokens';

export const tokenStore = {
  get(): Tokens | null {
    try {
      return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  set(t: Tokens | null) {
    if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKENS_KEY);
  },
};

let onAuthLost: () => void = () => {};
export const setOnAuthLost = (fn: () => void) => {
  onAuthLost = fn;
};

async function rawFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new NetworkError((err as Error).message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refreshTokens(): Promise<boolean> {
  const tokens = tokenStore.get();
  if (!tokens) return false;
  refreshing ??= (async () => {
    const res = await rawFetch(
      '/api/auth/refresh',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      },
      10_000,
    );
    if (!res.ok) return false;
    const body = await res.json();
    tokenStore.set(body.tokens);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** JSON request with the bearer token; refreshes once on 401. */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number; auth?: boolean } = {},
): Promise<T> {
  const send = () => {
    const tokens = tokenStore.get();
    return rawFetch(
      path,
      {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(options.auth !== false && tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      },
      options.timeoutMs ?? 15_000,
    );
  };

  let res = await send();
  if (res.status === 401 && options.auth !== false) {
    if (await refreshTokens()) res = await send();
    else {
      onAuthLost();
    }
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? res.statusText);
  }
  return body as T;
}
