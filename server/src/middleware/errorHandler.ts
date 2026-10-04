import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

export function createErrorHandler(isProduction: boolean): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) } });

    if (err instanceof HttpError) return send(err.status, err.code, err.message, err.details);
    if (err instanceof ZodError) {
      return send(
        400,
        'VALIDATION_ERROR',
        'Request validation failed',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    if (err instanceof mongoose.Error.CastError)
      return send(400, 'INVALID_ID', `Invalid value for ${err.path}`);
    if (err instanceof mongoose.Error.ValidationError) return send(400, 'VALIDATION_ERROR', err.message);
    if (err?.code === 11000) return send(409, 'DUPLICATE', 'A record with these details already exists');
    if (err?.type === 'entity.parse.failed')
      return send(400, 'INVALID_JSON', 'Request body is not valid JSON');
    if (err?.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');

    console.error(err);
    return send(500, 'INTERNAL_ERROR', isProduction ? 'Internal server error' : String(err?.message ?? err));
  };
}
