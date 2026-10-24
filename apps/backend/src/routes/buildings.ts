import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireRole } from '../auth/session.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { prisma } from '../shared/prisma.js';
import { buildingCodePattern, generateBuildingCode } from '../buildings/access-code.js';
import { compareBuildings } from '../buildings/address.js';
import { buildingSchema, createBuilding, defaultApartmentCodeHash, findDuplicate } from '../buildings/building-service.js';
import { buildingWhere, requireCompanyId, type AdminActor } from '../auth/scope.js';
import { deleteBuildingData } from '../buildings/delete-building.js';
import { deletePhotoFiles } from '../photos/storage.js';
import { requireUuidParams } from '../shared/params.js';
import { houseLink } from '../buildings/house-link.js';

export const buildingsRouter = Router();
buildingsRouter.use(requireAdmin);
requireUuidParams(buildingsRouter, 'id');

const accessCodeSchema = z.object({ code: z.string().regex(buildingCodePattern).optional() });

// The access code is returned only by the dedicated supervisor endpoint.
function publicBuilding<T extends { accessCode: string }>({ accessCode: _accessCode, ...building }: T) {
  return building;
}

buildingsRouter.get('/', async (_request, response, next) => {
  try {
    const items = await prisma.building.findMany({
      where: buildingWhere(response.locals.companyId),
      include: { _count: { select: { apartments: true, incidents: true } } },
    });
    response.json({ items: items.sort(compareBuildings).map(publicBuilding) });
  } catch (error) { next(error); }
});

// The link for the QR code at the entrance: the bot opens with this house chosen.
buildingsRouter.get('/:id/resident-link', async (request, response, next) => {
  try {
    const building = await prisma.building.findFirst({ where: { id: String(request.params.id), ...buildingWhere(response.locals.companyId) }, select: { id: true, address: true, company: { select: { name: true, phone: true } } } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    const link = houseLink(building.id);
    if (!link) { response.status(409).json({ code: 'bot_username_missing' }); return; }
    response.json({ link, address: building.address, companyName: building.company.name, companyPhone: building.company.phone });
  } catch (error) { next(error); }
});

buildingsRouter.get('/:id/access-code', requireRole('supervisor'), async (request, response, next) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    const building = await prisma.building.findFirst({ where: { id: String(request.params.id), ...buildingWhere(response.locals.companyId) }, select: { id: true, accessCode: true } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    const admin = response.locals.admin as { id: string };
    await writeAdminAudit(prisma, admin.id, 'building_code_revealed', 'building', building.id);
    response.json({ code: building.accessCode });
  } catch (error) { next(error); }
});

buildingsRouter.patch('/:id/access-code', requireRole('supervisor'), async (request, response, next) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = accessCodeSchema.safeParse(request.body ?? {});
    if (!parsed.success) { response.status(400).json({ code: 'invalid_building_code' }); return; }
    const building = await prisma.building.findFirst({ where: { id: String(request.params.id), ...buildingWhere(response.locals.companyId) }, select: { id: true } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    // Without an explicit code a new random one is generated.
    const code = parsed.data.code ?? generateBuildingCode();
    const admin = response.locals.admin as { id: string };
    await prisma.$transaction(async (tx) => {
      await tx.building.update({ where: { id: building.id }, data: { accessCode: code } });
      await writeAdminAudit(tx, admin.id, 'building_code_changed', 'building', building.id, { generated: parsed.data.code === undefined });
    });
    response.json({ code });
  } catch (error) { next(error); }
});

buildingsRouter.post('/', async (request, response, next) => {
  try {
    const parsed = buildingSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_building', details: parsed.error.flatten() }); return; }
    const admin = response.locals.admin as AdminActor;
    const result = await createBuilding(admin, requireCompanyId(admin, response.locals.companyId), parsed.data);
    if (!result.ok) { response.status(409).json({ code: result.code }); return; }
    response.status(201).json({ item: publicBuilding(result.item) });
  } catch (error) { next(error); }
});

buildingsRouter.patch('/:id', async (request, response, next) => {
  try {
    const parsed = buildingSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_building', details: parsed.error.flatten() }); return; }
    const existing = await prisma.building.findFirst({ where: { id: request.params.id, ...buildingWhere(response.locals.companyId) }, select: { id: true, apartmentsCount: true } });
    if (!existing) { response.status(404).json({ code: 'building_not_found' }); return; }
    if (await findDuplicate(parsed.data.street, parsed.data.house, existing.id, parsed.data.city)) { response.status(409).json({ code: 'building_exists' }); return; }
    // Fewer apartments: the numbers above the new count go, but only those
    // nobody ever used — an apartment with residents or incidents stays, and
    // the change is refused with their numbers.
    const surplus = parsed.data.apartmentsCount < existing.apartmentsCount
      ? (await prisma.apartment.findMany({
        where: { buildingId: existing.id },
        select: { id: true, number: true, _count: { select: { memberships: true, reports: true, incidentComments: true } } },
      })).filter((apartment) => /^\d+$/.test(apartment.number) && Number(apartment.number) > parsed.data.apartmentsCount)
      : [];
    const used = surplus.filter((apartment) => apartment._count.memberships || apartment._count.reports || apartment._count.incidentComments);
    if (used.length) {
      response.status(409).json({ code: 'apartments_in_use', apartments: used.map((apartment) => apartment.number).sort((left, right) => Number(left) - Number(right)).slice(0, 20) });
      return;
    }
    const item = await prisma.$transaction(async (tx) => {
      if (surplus.length) await tx.apartment.deleteMany({ where: { id: { in: surplus.map((apartment) => apartment.id) } } });
      if (parsed.data.apartmentsCount > existing.apartmentsCount) {
        await tx.apartment.createMany({
          data: Array.from({ length: parsed.data.apartmentsCount - existing.apartmentsCount }, (_, index) => ({
            buildingId: existing.id,
            number: String(existing.apartmentsCount + index + 1),
            inviteCodeHash: defaultApartmentCodeHash(),
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
    response.json({ item: publicBuilding(item) });
  } catch (error) { next(error); }
});

buildingsRouter.delete('/:id', requireRole('supervisor'), async (request, response, next) => {
  try {
    const building = await prisma.building.findFirst({ where: { id: String(request.params.id), ...buildingWhere(response.locals.companyId) }, select: { id: true } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    const removed = await prisma.$transaction(async (tx) => {
      const { photoIds, ...result } = await deleteBuildingData(tx, building.id);
      const admin = response.locals.admin as { id: string };
      await writeAdminAudit(tx, admin.id, 'building_deleted', 'building', building.id, result);
      return { ...result, photoIds };
    });
    await deletePhotoFiles(removed.photoIds);
    response.json({ revokedMemberships: removed.revokedMemberships });
  } catch (error) { next(error); }
});
