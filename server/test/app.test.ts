import { redFlagEngine } from '@ruralcare/shared';
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { fakeAi, makeApp, TEST_MODEL_VERSION, useTestDb } from './helpers';

useTestDb();

describe('GET /health', () => {
  it('reports dependencies and the shared rules version', async () => {
    const res = await request(makeApp(fakeAi(undefined, true))).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      dependencies: { mongodb: 'up', aiService: 'up', timescaledb: 'disabled', mqtt: 'disabled' },
      shared: {
        redFlagRulesVersion: redFlagEngine.rulesVersion,
        safetyFloorCount: redFlagEngine.floors.length,
      },
    });
  });

  it('stays 200 when only the AI service is down', async () => {
    const res = await request(makeApp(fakeAi(undefined, false))).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.dependencies.aiService).toBe('down');
  });

  it('is 503 when MongoDB is down', async () => {
    const state = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    try {
      const res = await request(makeApp()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.dependencies.mongodb).toBe('down');
    } finally {
      if (state) Object.defineProperty(mongoose.connection, 'readyState', state);
      else delete (mongoose.connection as { readyState?: number }).readyState;
    }
  });
});

describe('GET /api/model/version', () => {
  it('proxies the AI service model version (public, no-cache)', async () => {
    const res = await request(makeApp(fakeAi(undefined, true))).get('/api/model/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(TEST_MODEL_VERSION);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('is 503 when the model is unavailable', async () => {
    const res = await request(makeApp(fakeAi(undefined, false))).get('/api/model/version');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('MODEL_UNAVAILABLE');
  });
});

describe('API docs', () => {
  it('serves an OpenAPI 3.1 document covering every route', async () => {
    const res = await request(makeApp()).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths).sort()).toEqual([
      '/api/alerts',
      '/api/alerts/{id}',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/auth/register',
      '/api/dashboard/stats',
      '/api/model/version',
      '/api/patients',
      '/api/patients/{id}',
      '/api/triage',
      '/api/triage/sync',
      '/api/triage/{id}',
      '/api/triage/{id}/notes',
      '/api/triage/{id}/review',
      '/api/users',
      '/api/users/{id}',
      '/api/villages',
      '/api/vitals/{id}',
      '/api/vitals/{id}/latest',
    ]);
    expect(res.body.components.schemas).toHaveProperty('TriageRequest');
    expect(res.body.components.securitySchemes).toHaveProperty('bearerAuth');
  });

  it('serves Swagger UI at /api/docs', async () => {
    const res = await request(makeApp()).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});

describe('error handling', () => {
  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(makeApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .set('content-type', 'application/json')
      .send('{"phone":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('sets security headers', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('loadEnv', () => {
  const base = {
    MONGO_URI: 'mongodb://localhost/x',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  it('applies defaults and splits CORS origins', () => {
    const env = loadEnv({ ...base, CORS_ORIGIN: 'http://a.test, http://b.test' });
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
  });

  it('requires MONGO_URI and strong, distinct JWT secrets', () => {
    expect(() => loadEnv({ ...base, MONGO_URI: '' })).toThrow(/MONGO_URI/);
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() => loadEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow(/must differ/);
  });

  it('refuses example secrets in production', () => {
    const example = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change_me_'.repeat(4) };
    expect(() => loadEnv(example)).toThrow(/example JWT secrets/);
  });
});
