import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';

export const announcementsRouter = Router();
announcementsRouter.use(requireAdmin);

const announcementSchema = z.object({
  audience: z.enum(['all', 'apartment']),
  apartmentId: z.string().uuid().optional(),
  text: z.string().trim().min(3).max(2000),
}).superRefine((value, context) => {
  if (value.audience === 'apartment' && !value.apartmentId) {
    context.addIssue({ code: 'custom', path: ['apartmentId'], message: 'Apartment is required' });
  }
});

announcementsRouter.get('/apartments', async (_request, response, next) => {
  try {
    const items = await prisma.apartment.findMany({
      where: { memberships: { some: { revokedAt: null } } },
      select: { id: true, number: true, building: { select: { address: true } }, _count: { select: { memberships: { where: { revokedAt: null } } } } },
    });
    items.sort((left, right) => left.building.address.localeCompare(right.building.address, 'ru') || left.number.localeCompare(right.number, 'ru', { numeric: true }));
    response.json({ items });
  } catch (error) { next(error); }
});

announcementsRouter.post('/', async (request, response, next) => {
  try {
    const parsed = announcementSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_announcement', details: parsed.error.flatten() }); return; }
    const apartmentFilter = parsed.data.audience === 'apartment' && parsed.data.apartmentId ? { apartmentId: parsed.data.apartmentId } : {};
    const memberships = await prisma.residentMembership.findMany({
      where: { revokedAt: null, ...apartmentFilter },
      distinct: ['userId'],
      select: { user: { select: { maxUserId: true } } },
    });
    if (!memberships.length) { response.status(404).json({ code: 'recipients_not_found' }); return; }
    const text = parsed.data.audience === 'apartment'
      ? `Сообщение от диспетчера, адресованное вашей квартире:\n«${parsed.data.text}»`
      : `Сообщение от диспетчера, адресованное дому:\n«${parsed.data.text}»`;
    const admin = response.locals.admin as { id: string };
    await prisma.$transaction(async (tx) => {
      await tx.outboxMessage.createMany({
        data: memberships.map(({ user }) => ({ type: 'admin_announcement', payload: { userId: user.maxUserId, text } })),
      });
      await writeAdminAudit(tx, admin.id, 'announcement_queued', 'announcement', null, {
        audience: parsed.data.audience,
        apartmentId: parsed.data.apartmentId ?? null,
        recipientsCount: memberships.length,
      });
    });
    response.status(202).json({ recipientsCount: memberships.length });
  } catch (error) { next(error); }
});
