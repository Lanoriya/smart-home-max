import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';

// Taking the access of a company employee away: they are no longer bound to
// the company or to their MAX account and every session ends. The record
// stays, so the history of incidents and the action log keep the name.
export async function revokeAdminAccess(tx: Prisma.TransactionClient, admin: { id: string; displayName: string | null; username: string }) {
  await tx.adminSession.deleteMany({ where: { adminId: admin.id } });
  await tx.adminLoginLink.deleteMany({ where: { adminId: admin.id } });
  await tx.admin.update({
    where: { id: admin.id },
    data: {
      companyId: null, maxUserId: null,
      username: `removed-${admin.id}`,
      displayName: `${admin.displayName ?? admin.username} (удалён)`,
      passwordHash: `removed:${randomBytes(24).toString('hex')}`,
    },
  });
}
