import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';

export const emergencyServicesRouter = Router();
emergencyServicesRouter.use(requireAdmin);

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(3).max(50),
  description: z.string().trim().min(2).max(400),
});

emergencyServicesRouter.get('/', async (_request, response, next) => {
  try {
    const items = await prisma.emergencyService.findMany({ orderBy: { createdAt: 'asc' } });
    response.json({ items });
  } catch (error) { next(error); }
});

emergencyServicesRouter.post('/', async (request, response, next) => {
  try {
    const parsed = serviceSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_emergency_service', details: parsed.error.flatten() }); return; }
    const admin = response.locals.admin as { id: string };
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.emergencyService.create({ data: parsed.data });
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
    const exists = await prisma.emergencyService.findUnique({ where: { id: request.params.id }, select: { id: true } });
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
    const exists = await prisma.emergencyService.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!exists) { response.status(404).json({ code: 'emergency_service_not_found' }); return; }
    const admin = response.locals.admin as { id: string };
    await prisma.$transaction(async (tx) => {
      await tx.emergencyService.delete({ where: { id: exists.id } });
      await writeAdminAudit(tx, admin.id, 'emergency_service_deleted', 'emergency_service', exists.id);
    });
    response.status(204).end();
  } catch (error) { next(error); }
});
