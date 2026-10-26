import { describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  admin: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
const revokeMock = vi.hoisted(() => ({ revokeAdminAccess: vi.fn() }));
vi.mock('../src/shared/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/auth/revoke-admin.js', () => revokeMock);
vi.mock('../src/config/env.js', () => ({ env: { PLATFORM_ADMIN_MAX_USER_IDS: ['100'] } }));

const { leaveAdmin } = await import('../src/auth/leave-admin.js');

const record = (fields: Record<string, unknown>) => ({ id: 'a1', role: 'supervisor', username: 'max_5', displayName: 'Аня', companyId: 'c1', maxUserId: '5', company: { name: 'УК' }, ...fields });

describe('leaving the admin access', () => {
  it('lets a platform administrator from an invitation or a link leave', async () => {
    prismaMock.admin.findUnique.mockResolvedValue(record({ role: 'platform_admin', companyId: null, company: null }));
    prismaMock.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<void>) => work({ adminAuditEvent: { create: vi.fn() } }));
    await expect(leaveAdmin('a1')).resolves.toEqual({ ok: true, role: 'platform_admin', companyName: null });
    expect(revokeMock.revokeAdminAccess).toHaveBeenCalled();
  });

  it('keeps administrators from the environment and the jury accounts', async () => {
    revokeMock.revokeAdminAccess.mockClear();
    prismaMock.admin.findUnique.mockResolvedValueOnce(record({ role: 'platform_admin', companyId: null, maxUserId: '100' }));
    await expect(leaveAdmin('a1')).resolves.toEqual({ ok: false, code: 'platform_admin_from_env' });
    prismaMock.admin.findUnique.mockResolvedValueOnce(record({ username: 'jury-uk', maxUserId: null }));
    await expect(leaveAdmin('a1')).resolves.toEqual({ ok: false, code: 'demo_account' });
    expect(revokeMock.revokeAdminAccess).not.toHaveBeenCalled();
  });
});
