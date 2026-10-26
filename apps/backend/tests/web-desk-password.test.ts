import { describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { upsert: vi.fn() },
  admin: { findUnique: vi.fn() },
}));
const sessionMock = vi.hoisted(() => ({ getAuthenticatedAdmin: vi.fn() }));
vi.mock('../src/shared/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/auth/session.js', () => sessionMock);

const { requireMiniAppUser } = await import('../src/miniapp/auth.js');

describe('web desk with a password account', () => {
  it('acts as the signed-in administrator without a MAX account', async () => {
    const admin = { id: 'a1', username: 'jury-uk', role: 'supervisor', companyId: 'c1', maxUserId: null };
    sessionMock.getAuthenticatedAdmin.mockResolvedValue({ admin: { ...admin, company: { id: 'c1', name: 'Demo' } } });
    prismaMock.user.upsert.mockResolvedValue({ id: 'u1', maxUserId: 'web-a1', displayName: null });
    const request = { header: (name: string) => (name === 'x-web-desk' ? '1' : undefined) };
    const response = { locals: {} as Record<string, unknown>, status: vi.fn() };
    const next = vi.fn();

    await requireMiniAppUser(request as never, response as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { maxUserId: 'web-a1' } }));
    expect(prismaMock.admin.findUnique).not.toHaveBeenCalled();
    expect(response.locals.miniApp).toMatchObject({ admin: { id: 'a1', role: 'supervisor', companyId: 'c1' } });
  });
});
