import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireRole } from '../auth/session.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { prisma } from '../shared/prisma.js';

export const buildingsRouter = Router();
buildingsRouter.use(requireAdmin);

const buildingSchema = z.object({
  address: z.string().trim().min(5).max(300),
  apartmentsCount: z.number().int().min(1).max(2000),
  entrancesCount: z.number().int().min(1).max(50),
  chatLink: z.string().trim().url().max(500).nullable().optional(),
});

buildingsRouter.get('/', async (_request, response, next) => {
  try {
    const items = await prisma.building.findMany({
      orderBy: { address: 'asc' },
      include: { _count: { select: { apartments: true, incidents: true } } },
    });
    response.json({ items });
  } catch (error) { next(error); }
});

buildingsRouter.post('/', async (request, response, next) => {
  try {
    const parsed = buildingSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_building', details: parsed.error.flatten() }); return; }
    const item = await prisma.$transaction(async (tx) => {
      const building = await tx.building.create({ data: { ...parsed.data, chatLink: parsed.data.chatLink || null } });
      await tx.apartment.createMany({
        data: Array.from({ length: parsed.data.apartmentsCount }, (_, index) => ({
          buildingId: building.id,
          number: String(index + 1),
        })),
      });
      const admin = response.locals.admin as { id: string };
      await writeAdminAudit(tx, admin.id, 'building_created', 'building', building.id, {
        apartmentsCount: parsed.data.apartmentsCount,
        entrancesCount: parsed.data.entrancesCount,
      });
      return building;
    });
    response.status(201).json({ item });
  } catch (error) { next(error); }
});

buildingsRouter.patch('/:id', async (request, response, next) => {
  try {
    const parsed = buildingSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_building', details: parsed.error.flatten() }); return; }
    const existing = await prisma.building.findUnique({ where: { id: request.params.id }, select: { id: true, apartmentsCount: true } });
    if (!existing) { response.status(404).json({ code: 'building_not_found' }); return; }
    const item = await prisma.$transaction(async (tx) => {
      if (parsed.data.apartmentsCount > existing.apartmentsCount) {
        await tx.apartment.createMany({
          data: Array.from({ length: parsed.data.apartmentsCount - existing.apartmentsCount }, (_, index) => ({
            buildingId: existing.id,
            number: String(existing.apartmentsCount + index + 1),
          })),
          skipDuplicates: true,
        });
      }
      const updated = await tx.building.update({ where: { id: existing.id }, data: { ...parsed.data, chatLink: parsed.data.chatLink || null } });
      const admin = response.locals.admin as { id: string };
      await writeAdminAudit(tx, admin.id, 'building_updated', 'building', existing.id, {
        apartmentsCount: parsed.data.apartmentsCount,
        entrancesCount: parsed.data.entrancesCount,
      });
      return updated;
    });
    response.json({ item });
  } catch (error) { next(error); }
});

buildingsRouter.delete('/:id', requireRole('supervisor'), async (request, response, next) => {
  try {
    const building = await prisma.building.findUnique({ where: { id: String(request.params.id) }, select: { id: true } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    const revokedMemberships = await prisma.$transaction(async (tx) => {
      const incidents = await tx.incident.findMany({ where: { buildingId: building.id }, select: { id: true } });
      const incidentIds = incidents.map((incident) => incident.id);
      if (incidentIds.length) {
        await tx.outboxMessage.deleteMany({ where: { incidentId: { in: incidentIds } } });
        await tx.incidentPhoto.deleteMany({ where: { incidentId: { in: incidentIds } } });
        await tx.incidentComment.deleteMany({ where: { incidentId: { in: incidentIds } } });
        await tx.incidentEvent.deleteMany({ where: { incidentId: { in: incidentIds } } });
        await tx.incidentSubscription.deleteMany({ where: { incidentId: { in: incidentIds } } });
        await tx.report.deleteMany({ where: { incidentId: { in: incidentIds } } });
        await tx.incident.deleteMany({ where: { id: { in: incidentIds } } });
      }
      const memberships = await tx.residentMembership.count({ where: { apartment: { buildingId: building.id }, revokedAt: null } });
      await tx.residentMembership.deleteMany({ where: { apartment: { buildingId: building.id } } });
      await tx.vehicle.deleteMany({ where: { apartment: { is: { buildingId: building.id } } } });
      await tx.residentProfile.deleteMany({ where: { apartment: { is: { buildingId: building.id } } } });
      await tx.apartment.deleteMany({ where: { buildingId: building.id } });
      await tx.building.delete({ where: { id: building.id } });
      const admin = response.locals.admin as { id: string };
      await writeAdminAudit(tx, admin.id, 'building_deleted', 'building', building.id, {
        revokedMemberships: memberships,
        deletedIncidents: incidentIds.length,
      });
      return memberships;
    });
    response.json({ revokedMemberships });
  } catch (error) { next(error); }
});
