import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: { JURY_UK_LINK_TOKEN: 'uk-token-123456', JURY_ADMIN_LINK_TOKEN: undefined, MAX_BOT_USERNAME: 'demo_bot' },
}));
vi.mock('../src/shared/prisma.js', () => ({ prisma: {} }));

const { juryLink, juryRoleFromStartPayload } = await import('../src/auth/jury-link.js');

describe('jury links', () => {
  it('accepts only the configured token', () => {
    expect(juryRoleFromStartPayload('jury_uk_uk-token-123456', new Date('2026-10-29T12:00:00+03:00'))).toBe('uk');
    expect(juryRoleFromStartPayload('jury_uk_uk-token-654321')).toBeNull();
    expect(juryRoleFromStartPayload('jury_uk_uk-token-1234567')).toBeNull();
    expect(juryRoleFromStartPayload(null)).toBeNull();
  });

  it('works through 5 November (Moscow) and expires after it', () => {
    expect(juryRoleFromStartPayload('jury_uk_uk-token-123456', new Date('2026-11-05T23:00:00+03:00'))).toBe('uk');
    expect(juryRoleFromStartPayload('jury_uk_uk-token-123456', new Date('2026-11-06T00:00:01+03:00'))).toBe('expired');
    expect(juryRoleFromStartPayload('jury_uk_wrong-token-1234', new Date('2026-11-06T00:00:01+03:00'))).toBeNull();
  });

  it('keeps a link without a token switched off', () => {
    expect(juryRoleFromStartPayload('jury_admin_uk-token-123456')).toBeNull();
    expect(juryLink('admin')).toBeNull();
    expect(juryLink('uk')).toBe('https://max.ru/demo_bot?start=jury_uk_uk-token-123456');
  });
});
