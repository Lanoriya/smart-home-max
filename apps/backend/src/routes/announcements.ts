import { Router } from 'express';
import { requireAdmin } from '../auth/session.js';
import { prisma } from '../shared/prisma.js';
import { requireCompanyId, viaBuilding, type AdminActor } from '../auth/scope.js';
import { announcementHistorySchema, announcementSchema, companyAnnouncements, deleteAnnouncement, queueAnnouncement, setAnnouncementArchived } from '../announcements/announcement-service.js';
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

announcementsRouter.get('/', async (request, response, next) => {
  try {
    const parsed = announcementHistorySchema.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_announcement_query' }); return; }
    response.json(await companyAnnouncements(response.locals.companyId, parsed.data.archived === 'true', parsed.data.page));
  } catch (error) { next(error); }
});

// Into the archive and back: residents see only the current announcements.
for (const [action, archived] of [['archive', true], ['restore', false]] as const) {
  announcementsRouter.post(`/:id/${action}`, async (request, response, next) => {
    try {
      const admin = response.locals.admin as { id: string };
      if (!await setAnnouncementArchived(admin.id, response.locals.companyId, String(request.params.id), archived)) { response.status(404).json({ code: 'announcement_not_found' }); return; }
      response.status(204).end();
    } catch (error) { next(error); }
  });
}

announcementsRouter.delete('/:id', async (request, response, next) => {
  try {
    const admin = response.locals.admin as { id: string };
    if (!await deleteAnnouncement(admin.id, response.locals.companyId, String(request.params.id))) { response.status(404).json({ code: 'announcement_not_found' }); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});
