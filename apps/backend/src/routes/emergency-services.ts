import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { requireCompanyId, type AdminActor } from '../auth/scope.js';
import { requireUuidParams } from '../shared/params.js';

export const emergencyServicesRouter = Router();
emergencyServicesRouter.use(requireAdmin);
requireUuidParams(emergencyServicesRouter, 'id');

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(3).max(50),
  description: z.string().trim().min(2).max(400),
});

emergencyServicesRouter.get('/', async (_request, response, next) => {
  try {
    const companyId = response.locals.companyId as string | null;
    const items = await prisma.emergencyService.findMany({ where: companyId ? { companyId } : {}, orderBy: { createdAt: 'asc' } });
    response.json({ items });
  } catch (error) { next(error); }
});

emergencyServicesRouter.post('/', async (request, response, next) => {
  try {
    const parsed = serviceSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_emergency_service', details: parsed.error.flatten() }); return; }
    const admin = response.locals.admin as AdminActor;
    const companyId = requireCompanyId(admin, response.locals.companyId);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.emergencyService.create({ data: { ...parsed.data, companyId } });
      await writeAdminAudit(tx, admin.id, 'emergency_service_created', 'emergency_service', created.id);
      return created;
    });
    response.status(201).json({ item });
  } catch (error) { next(error); }
});

emergencyServicesRouter.patch('/:id', async (request, response, next) => {
  try {
    const parsed = serviceSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_emergency_service', details: parsed.error.flatten() }); return; }
    const exists = await prisma.emergencyService.findFirst({ where: { id: request.params.id, ...ownServices(response.locals.companyId) }, select: { id: true } });
    if (!exists) { response.status(404).json({ code: 'emergency_service_not_found' }); return; }
    const admin = response.locals.admin as { id: string };
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.emergencyService.update({ where: { id: exists.id }, data: parsed.data });
      await writeAdminAudit(tx, admin.id, 'emergency_service_updated', 'emergency_service', exists.id);
      return updated;
    });
    response.json({ item });
  } catch (error) { next(error); }
});

emergencyServicesRouter.delete('/:id', async (request, response, next) => {
  try {
    const exists = await prisma.emergencyService.findFirst({ where: { id: request.params.id, ...ownServices(response.locals.companyId) }, select: { id: true } });
    if (!exists) { response.status(404).json({ code: 'emergency_service_not_found' }); return; }
    const admin = response.locals.admin as { id: string };
    await prisma.$transaction(async (tx) => {
      await tx.emergencyService.delete({ where: { id: exists.id } });
      await writeAdminAudit(tx, admin.id, 'emergency_service_deleted', 'emergency_service', exists.id);
    });
    response.status(204).end();
  } catch (error) { next(error); }
});

// A company edits only its own numbers; city-wide ones belong to the platform.
function ownServices(companyId: string | null) {
  return companyId ? { companyId } : {};
}
