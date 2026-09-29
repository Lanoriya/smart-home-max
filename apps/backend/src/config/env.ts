import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({
  path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
  quiet: true,
});

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z
      .string()
      .default('postgresql://app:change-me@localhost:5432/smart_home?schema=public'),
    ADMIN_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    MAX_MODE: z.enum(['fake', 'api']).default('fake'),
    MAX_RECEIVE_MODE: z.enum(['none', 'polling', 'webhook']).default('none'),
    MAX_API_BASE_URL: z.string().url().default('https://platform-api2.max.ru'),
    MAX_BOT_TOKEN: z.string().optional(),
    MAX_WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{5,256}$/)
      .default('dev-secret-change-me'),
    MAX_PUBLIC_WEBHOOK_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    APARTMENT_CODE_PEPPER: z.string().min(12).default('dev-apartment-pepper'),
    RESIDENT_UK_CODE: z.string().regex(/^\d{10}$/),
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    ADMIN_COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine((value, context) => {
    if (value.MAX_MODE === 'api' && !value.MAX_BOT_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['MAX_BOT_TOKEN'],
        message: 'MAX_BOT_TOKEN is required when MAX_MODE=api',
      });
    }
    if (value.MAX_RECEIVE_MODE === 'webhook' && !value.MAX_PUBLIC_WEBHOOK_URL) {
      context.addIssue({
        code: 'custom',
        path: ['MAX_PUBLIC_WEBHOOK_URL'],
        message: 'MAX_PUBLIC_WEBHOOK_URL is required when MAX_RECEIVE_MODE=webhook',
      });
    }
    if (value.NODE_ENV === 'production') {
      const unsafeValues = [
        ['MAX_WEBHOOK_SECRET', value.MAX_WEBHOOK_SECRET, ['dev-secret-change-me', 'change-me-webhook-secret']],
        ['APARTMENT_CODE_PEPPER', value.APARTMENT_CODE_PEPPER, ['dev-apartment-pepper', 'change-me-apartment-code-pepper']],
      ] as const;
      for (const [path, actual, forbidden] of unsafeValues) {
        if (forbidden.includes(actual as never)) {
          context.addIssue({ code: 'custom', path: [path], message: `${path} must be replaced in production` });
        }
      }
      if (!value.ADMIN_COOKIE_SECURE) {
        context.addIssue({ code: 'custom', path: ['ADMIN_COOKIE_SECURE'], message: 'Secure admin cookie is required in production' });
      }
      if (value.DATABASE_URL.includes('change-me')) {
        context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Database password must be replaced in production' });
      }
      if (value.RESIDENT_UK_CODE === '0000000000') {
        context.addIssue({ code: 'custom', path: ['RESIDENT_UK_CODE'], message: 'Resident access code must be replaced in production' });
      }
      if (value.MAX_WEBHOOK_SECRET.length < 24) {
        context.addIssue({ code: 'custom', path: ['MAX_WEBHOOK_SECRET'], message: 'Production webhook secret must contain at least 24 characters' });
      }
      if (value.APARTMENT_CODE_PEPPER.length < 32) {
        context.addIssue({ code: 'custom', path: ['APARTMENT_CODE_PEPPER'], message: 'Production pepper must contain at least 32 characters' });
      }
      if (!value.ADMIN_WEB_ORIGIN.startsWith('https://') || !value.MAX_PUBLIC_WEBHOOK_URL?.startsWith('https://')) {
        context.addIssue({ code: 'custom', path: ['ADMIN_WEB_ORIGIN'], message: 'Production public URLs must use HTTPS' });
      }
      if (value.TRUST_PROXY_HOPS === 0) {
        context.addIssue({ code: 'custom', path: ['TRUST_PROXY_HOPS'], message: 'Production reverse proxy must be trusted explicitly' });
      }
    }
  });

export function parseEnv(source: NodeJS.ProcessEnv) {
  return envSchema.parse(source);
}

export const env = parseEnv(process.env);
