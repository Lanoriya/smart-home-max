import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:0123456789abcdef@db:5432/smart_home',
  ADMIN_WEB_ORIGIN: 'https://dispatcher.example.test',
  MAX_MODE: 'api',
  MAX_RECEIVE_MODE: 'webhook',
  MAX_BOT_TOKEN: 'test-token',
  MAX_WEBHOOK_SECRET: '0123456789abcdefghijklmn',
  MAX_PUBLIC_WEBHOOK_URL: 'https://dispatcher.example.test/webhooks/max',
  APARTMENT_CODE_PEPPER: '0123456789abcdefghijklmnopqrstuv',
  RESIDENT_UK_CODE: '1234567890',
  ADMIN_COOKIE_SECURE: 'true',
  TRUST_PROXY_HOPS: '2',
};

describe('production environment validation', () => {
  it('accepts an explicit HTTPS production configuration', () => {
    expect(parseEnv(production).NODE_ENV).toBe('production');
  });

  it('rejects demonstration credentials in production', () => {
    expect(() => parseEnv({
      ...production,
      DATABASE_URL: 'postgresql://app:change-me@db:5432/smart_home',
      RESIDENT_UK_CODE: '0000000000',
      ADMIN_COOKIE_SECURE: 'false',
    })).toThrow();
  });
});
