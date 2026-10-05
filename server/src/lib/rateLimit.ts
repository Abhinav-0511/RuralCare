import type { Request, RequestHandler } from 'express';
import { HttpError } from './httpError';

/**
 * Fixed-window, in-memory rate limiter keyed by client IP. Enough for one server instance; with
 * several replicas (Phase 6) this needs a shared store such as Redis.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  now?: () => number;
}): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  const keyOf = opts.key ?? ((req: Request) => req.ip ?? 'unknown');

  return (req, res, next) => {
    const t = now();
    // Drop expired windows now and then so the map can't grow without bound.
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);

    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - t) / 1000)));
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, please try again later');
    }
    next();
  };
}
