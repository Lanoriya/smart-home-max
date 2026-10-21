import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { requireCompanyId, viaBuilding, type AdminActor } from '../auth/scope.js';
import { announcementSchema, queueAnnouncement } from '../announcements/announcement-service.js';
import { requireUuidParams } from '../shared/params.js';

export const announcementsRouter = Router();
announcementsRouter.use(requireAdmin);
requireUuidParams(announcementsRouter, 'id');

announcementsRouter.get('/apartments', async (_request, response, next) => {
  try {
    const items = await prisma.apartment.findMany({
      where: { memberships: { some: { revokedAt: null } }, ...viaBuilding(response.locals.companyId) },
      select: { id: true, number: true, building: { select: { id: true, address: true } }, _count: { select: { memberships: { where: { revokedAt: null } } } } },
    });
    items.sort((left, right) => left.building.address.localeCompare(right.building.address, 'ru') || left.number.localeCompare(right.number, 'ru', { numeric: true }));
    response.json({ items });
  } catch (error) { next(error); }
});

announcementsRouter.post('/', async (request, response, next) => {
  try {
    const parsed = announcementSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_announcement', details: parsed.error.flatten() }); return; }
    const admin = response.locals.admin as AdminActor;
    const result = await queueAnnouncement(admin, requireCompanyId(admin, response.locals.companyId), parsed.data);
    if (!result.ok) { response.status(404).json({ code: result.code }); return; }
    response.status(202).json({ recipientsCount: result.recipientsCount });
  } catch (error) { next(error); }
});

const historySchema = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });
const historyPageSize = 20;

announcementsRouter.get('/', async (request, response, next) => {
  try {
    const parsed = historySchema.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_announcement_query' }); return; }
    const [items, total] = await prisma.$transaction([
      prisma.announcement.findMany({
        where: ownAnnouncements(response.locals.companyId),
        orderBy: { createdAt: 'desc' },
        skip: (parsed.data.page - 1) * historyPageSize,
        take: historyPageSize,
        include: {
          building: { select: { address: true } },
          apartment: { select: { number: true, building: { select: { address: true } } } },
          admin: { select: { username: true } },
        },
      }),
      prisma.announcement.count({ where: ownAnnouncements(response.locals.companyId) }),
    ]);
    response.json({ items, total, page: parsed.data.page, pageSize: historyPageSize });
  } catch (error) { next(error); }
});

announcementsRouter.delete('/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'announcement_not_found' }); return; }
    const admin = response.locals.admin as { id: string };
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.announcement.deleteMany({ where: { id: request.params.id, ...ownAnnouncements(response.locals.companyId) } });
      if (result.count) await writeAdminAudit(tx, admin.id, 'announcement_deleted', 'announcement', request.params.id);
      return result.count;
    });
    if (!deleted) { response.status(404).json({ code: 'announcement_not_found' }); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});

function ownAnnouncements(companyId: string | null) {
  return companyId ? { companyId } : {};
}
