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
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    ADMIN_COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Public nick of the bot. Enables "open the app" buttons in the bot and
    // invitation links of the mini-app.
    MAX_BOT_USERNAME: z.preprocess(
      (value) => (value === '' ? undefined : String(value).replace(/^@/, '')),
      z.string().regex(/^[A-Za-z0-9_]{3,64}$/).optional(),
    ),
    // MAX accounts that open the mini-app as platform administrators.
    PLATFORM_ADMIN_MAX_USER_IDS: z.string().default('').transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
    // Secrets of the jury links ?start=jury_uk_<token> and ?start=jury_admin_<token>:
    // an employee of the demo company and a platform administrator. Empty — off.
    JURY_UK_LINK_TOKEN: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^[A-Za-z0-9_-]{12,100}$/).optional()),
    JURY_ADMIN_LINK_TOKEN: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^[A-Za-z0-9_-]{12,100}$/).optional()),
    // Local development only: lets the mini-app run in a usual browser with
    // the X-Dev-Max-User-Id header instead of signed MAX launch data.
    MINIAPP_DEV_AUTH: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    // Public address of the mini-app, for example https://example.ru/app/.
    MINIAPP_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
    // open_app — MAX opens the mini-app registered for the bot (needs it to be
    // set up in "MAX для бизнеса"); link — the bot sends a signed link to
    // MINIAPP_URL instead, for a bot without a registered mini-app.
    MINIAPP_OPEN_MODE: z.enum(['open_app', 'link']).default('open_app'),
    // Reverse geocoder (Nominatim API) used to recognise a house by a point.
    GEOCODER_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
    // Search-as-you-type of cities and streets (Photon API over OpenStreetMap).
    SUGGEST_URL: z.string().url().default('https://photon.komoot.io'),
    // Folder of the photos sent from the mini-app (a volume in Docker).
    PHOTOS_DIR: z.string().min(1).default(resolve(process.cwd(), 'data/photos')),
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
      if (value.MAX_WEBHOOK_SECRET.length < 24) {
        context.addIssue({ code: 'custom', path: ['MAX_WEBHOOK_SECRET'], message: 'Production webhook secret must contain at least 24 characters' });
      }
      if (value.APARTMENT_CODE_PEPPER.length < 32) {
        context.addIssue({ code: 'custom', path: ['APARTMENT_CODE_PEPPER'], message: 'Production pepper must contain at least 32 characters' });
      }
      if (!value.ADMIN_WEB_ORIGIN.startsWith('https://') || !value.MAX_PUBLIC_WEBHOOK_URL?.startsWith('https://')) {
        context.addIssue({ code: 'custom', path: ['ADMIN_WEB_ORIGIN'], message: 'Production public URLs must use HTTPS' });
      }
      if (value.MINIAPP_DEV_AUTH) {
        context.addIssue({ code: 'custom', path: ['MINIAPP_DEV_AUTH'], message: 'Development sign-in of the mini-app is forbidden in production' });
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
