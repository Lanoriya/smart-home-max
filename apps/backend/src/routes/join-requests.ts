import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { prisma } from '../shared/prisma.js';
import { viaApartment } from '../auth/scope.js';
import { activeRequestsSince, decideJoinRequest, requesterName } from '../residents/join-requests.js';
import { requireUuidParams } from '../shared/params.js';

export const joinRequestsRouter = Router();
joinRequestsRouter.use(requireAdmin);
requireUuidParams(joinRequestsRouter, 'id');

// Open requests to join apartments that already have residents. A dispatcher
// decides when the residents do not answer.
joinRequestsRouter.get('/', async (_request, response, next) => {
  try {
    const items = await prisma.apartmentJoinRequest.findMany({
      where: { status: 'pending', createdAt: { gte: activeRequestsSince() }, ...viaApartment(response.locals.companyId) },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { displayName: true, maxUsername: true } },
        apartment: { select: { id: true, number: true, building: { select: { address: true } }, _count: { select: { memberships: { where: { revokedAt: null } } } } } },
      },
    });
    response.json({
      items: items.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        requesterName: requesterName(item.user.displayName, item.user.maxUsername),
        apartmentId: item.apartment.id,
        apartmentNumber: item.apartment.number,
        address: item.apartment.building.address,
        residentsCount: item.apartment._count.memberships,
      })),
    });
  } catch (error) { next(error); }
});

joinRequestsRouter.post('/:id/:decision', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    const decision = z.enum(['approve', 'reject']).safeParse(request.params.decision);
    if (!id.success || !decision.success) { response.status(404).json({ code: 'not_found' }); return; }
    const admin = response.locals.admin as { id: string };
    const own = await prisma.apartmentJoinRequest.findFirst({ where: { id: id.data, ...viaApartment(response.locals.companyId) }, select: { id: true } });
    if (!own) { response.status(404).json({ code: 'not_found' }); return; }
    const result = await decideJoinRequest(id.data, decision.data, { adminId: admin.id });
    if (!result.ok) { response.status(409).json({ code: result.reason }); return; }
    await writeAdminAudit(prisma, admin.id, decision.data === 'approve' ? 'join_request_approved' : 'join_request_rejected', 'apartment_join_request', id.data);
    response.json({ status: result.status });
  } catch (error) { next(error); }
});
