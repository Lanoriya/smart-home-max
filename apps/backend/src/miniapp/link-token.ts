import { createHmac, timingSafeEqual } from 'node:crypto';

// Sign-in by link. Until the mini-app is registered for the bot in "MAX для
// бизнеса", MAX cannot open it with launch data. The bot then sends a usual
// link to the app with a short-lived token of the recipient: whoever opens the
// link in their own chat with the bot is that MAX user. The token is signed
// with a key derived from the bot token, like the launch data of MAX.

// Two hours: enough to open the link from the chat, short enough that a
// forwarded or leaked link soon stops acting for its owner.
export const linkTokenLifetimeSeconds = 2 * 60 * 60;

function key(botToken: string) {
  return createHmac('sha256', 'MiniAppLink').update(botToken).digest();
}

export function signLinkToken(maxUserId: string, botToken: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: maxUserId, e: Math.floor(now / 1000) + linkTokenLifetimeSeconds })).toString('base64url');
  const signature = createHmac('sha256', key(botToken)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyLinkToken(token: string, botToken: string, now = Date.now()): { maxUserId: string } | 'expired' | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(createHmac('sha256', key(botToken)).update(payload).digest('base64url'));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown };
    if (typeof data.u !== 'string' || !/^\d{1,20}$/.test(data.u) || typeof data.e !== 'number') return null;
    if (data.e < now / 1000) return 'expired';
    return { maxUserId: data.u };
  } catch {
    return null;
  }
}
