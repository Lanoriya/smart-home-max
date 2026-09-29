import type { Prisma, PrismaClient } from '@prisma/client';

type AuditDatabase = Pick<PrismaClient, 'adminAuditEvent'> | Prisma.TransactionClient;

export function writeAdminAudit(
  database: AuditDatabase,
  adminId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  payload: Prisma.InputJsonObject = {},
) {
  return database.adminAuditEvent.create({
    data: { adminId, action, entityType, entityId, payload },
  });
}
