import { redFlagEngine } from '@ruralcare/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadEnv } from './config/env';

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: ['http://localhost:5173'] });

describe('GET /health', () => {
  it('returns ok with the shared rules version the server loaded', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.shared.redFlagRulesVersion).toBe(redFlagEngine.rulesVersion);
    expect(res.body.shared.redFlagRuleCount).toBeGreaterThanOrEqual(8);
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('loadEnv', () => {
  it('applies defaults and splits CORS origins', () => {
    const env = loadEnv({ CORS_ORIGIN: 'http://a.test, http://b.test' });
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });
});
