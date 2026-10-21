import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Launch data of the MAX mini-app (window.WebApp.initData). MAX signs it with
// the bot token, so the backend can trust the user id inside without any
// password: HMAC-SHA256 with the key HMAC-SHA256("WebAppData", token) over the
// sorted "key=value" lines, compared with the "hash" parameter.

const maxUserSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  username: z.string().nullish(),
});

export type MiniAppUser = {
  maxUserId: string;
  displayName: string | null;
  username: string | null;
};

export type InitData = {
  user: MiniAppUser;
  authDate: Date;
  startParam: string | null;
};

export type InitDataError = 'missing_hash' | 'bad_signature' | 'expired' | 'no_user' | 'malformed';

export function signInitData(params: Record<string, string>, botToken: string): string {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const checkString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('\n');
  return createHmac('sha256', secret).update(checkString).digest('hex');
}

export function verifyInitData(
  raw: string,
  botToken: string,
  { maxAgeSeconds = 24 * 60 * 60, now = Date.now() }: { maxAgeSeconds?: number; now?: number } = {},
): { ok: true; data: InitData } | { ok: false; error: InitDataError } {
  let search: URLSearchParams;
  try {
    search = new URLSearchParams(raw);
  } catch {
    return { ok: false, error: 'malformed' };
  }
  const params: Record<string, string> = {};
  let hash: string | null = null;
  for (const [key, value] of search) {
    // Every parameter must appear once; a repeated one could hide a forged value.
    if (key in params || (key === 'hash' && hash !== null)) return { ok: false, error: 'malformed' };
    if (key === 'hash') hash = value;
    else params[key] = value;
  }
  if (!hash) return { ok: false, error: 'missing_hash' };

  const expected = Buffer.from(signInitData(params, botToken), 'hex');
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, error: 'bad_signature' };
  }

  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSeconds) return { ok: false, error: 'expired' };

  let user: MiniAppUser;
  try {
    const parsed = maxUserSchema.parse(JSON.parse(params.user ?? 'null'));
    const name = [parsed.first_name, parsed.last_name].filter(Boolean).join(' ').trim();
    user = { maxUserId: parsed.id, displayName: name || null, username: parsed.username?.replace(/^@/, '') || null };
  } catch {
    return { ok: false, error: 'no_user' };
  }

  return { ok: true, data: { user, authDate: new Date(authDate * 1000), startParam: params.start_param || null } };
}
