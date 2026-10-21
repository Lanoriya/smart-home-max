import { describe, expect, it } from 'vitest';
import { linkTokenLifetimeSeconds, signLinkToken, verifyLinkToken } from '../src/miniapp/link-token.js';

const token = 'test-bot-token';
const now = Date.UTC(2026, 9, 21, 12, 0, 0);

describe('sign-in by a personal link from the bot', () => {
  it('accepts a link signed for the user', () => {
    expect(verifyLinkToken(signLinkToken('292941745', token, now), token, now)).toEqual({ maxUserId: '292941745' });
  });

  it('refuses a link of another bot or with a changed user', () => {
    const link = signLinkToken('292941745', token, now);
    expect(verifyLinkToken(link, 'another-token', now)).toBeNull();
    const [payload, signature] = link.split('.');
    const forged = Buffer.from(JSON.stringify({ u: '1', e: JSON.parse(Buffer.from(payload!, 'base64url').toString()).e })).toString('base64url');
    expect(verifyLinkToken(`${forged}.${signature}`, token, now)).toBeNull();
  });

  it('expires after a day', () => {
    const link = signLinkToken('292941745', token, now);
    expect(verifyLinkToken(link, token, now + (linkTokenLifetimeSeconds + 1) * 1000)).toBe('expired');
  });

  it('ignores garbage', () => {
    expect(verifyLinkToken('abc', token, now)).toBeNull();
    expect(verifyLinkToken('a.b.c', token, now)).toBeNull();
  });
});
