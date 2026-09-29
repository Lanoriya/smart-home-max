import { createHmac, timingSafeEqual } from 'node:crypto';

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function hashInviteCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper)
    .update(normalizeInviteCode(code), 'utf8')
    .digest('hex');
}

export function inviteCodeMatches(code: string, storedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashInviteCode(code, pepper), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
