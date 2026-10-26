import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { companyStats } from '../stats/company-stats.js';
import { miniApp, requirePlatformAdmin } from './auth.js';
import { companyCardSchema, withOfficePoint } from './company.js';
import { createInvite } from './invites.js';
import { revokeAdminAccess } from '../auth/revoke-admin.js';
import { juryDemoUsername } from '../auth/jury-link.js';
import { dutiesSchema, lawDuties, platformDuties, savePlatformDuties } from '../companies/duties.js';
import { defaultPrivacy, getPrivacy, privacySchema, savePrivacy } from '../companies/privacy.js';
import { deleteBuildingData } from '../buildings/delete-building.js';
import { deletePhotoFiles } from '../photos/storage.js';

// The platform administrator connects management companies, puts them on
// the map and hands the first supervisor of each company an invitation.

export const platformRouter = Router();
platformRouter.use(requirePlatformAdmin);

platformRouter.get('/overview', async (_request, response, next) => {
  try {
    const companies = await prisma.managementCompany.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, phone: true, address: true, latitude: true, longitude: true, buildings: { select: { city: true }, distinct: ['city'] }, _count: { select: { buildings: true, admins: true } } } });
    const [total, perCompany, sizes] = await Promise.all([
      companyStats(null),
      Promise.all(companies.map((company) => companyStats(company.id))),
      // Apartments and entrances of the houses of each company.
      prisma.building.groupBy({ by: ['companyId'], _sum: { apartmentsCount: true, entrancesCount: true } }),
    ]);
    const sizeOf = new Map(sizes.map((size) => [size.companyId, size._sum]));
    response.json({
      total,
      companies: companies.map(({ _count, buildings, ...company }, index) => ({
        ...company, cities: buildings.map((building) => building.city).filter((city): city is string => Boolean(city)), buildingsCount: _count.buildings, adminsCount: _count.admins, stats: perCompany[index],
        apartmentsCount: sizeOf.get(company.id)?.apartmentsCount ?? 0, entrancesCount: sizeOf.get(company.id)?.entrancesCount ?? 0,
      })),
    });
  } catch (error) { next(error); }
});

platformRouter.post('/companies', async (request, response, next) => {
  try {
    const parsed = companyCardSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_company', details: parsed.error.flatten() }); return; }
    const { admin } = miniApp(response);
    const card = await withOfficePoint(parsed.data);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.managementCompany.create({ data: card });
      await writeAdminAudit(tx, admin!.id, 'company_created', 'management_company', created.id);
      return created;
    });
    response.status(201).json({ item });
  } catch (error) { next(error); }
});

platformRouter.patch('/companies/:id', async (request, response, next) => {
  try {
    const parsed = companyCardSchema.safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_company' }); return; }
    const { admin } = miniApp(response);
    const card = await withOfficePoint(parsed.data);
    const item = await prisma.$transaction(async (tx) => {
      const exists = await tx.managementCompany.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!exists) return null;
      const saved = await tx.managementCompany.update({ where: { id: exists.id }, data: card });
      await writeAdminAudit(tx, admin!.id, 'company_updated', 'management_company', exists.id);
      return saved;
    });
    if (!item) { response.status(404).json({ code: 'company_not_found' }); return; }
    response.json({ item });
  } catch (error) { next(error); }
});

// One role for all company staff; an old client may still send "dispatcher".
const inviteSchema = z.object({ role: z.enum(['dispatcher', 'supervisor']).default('supervisor').transform(() => 'supervisor' as const) });

platformRouter.post('/companies/:id/invites', async (request, response, next) => {
  try {
    const parsed = inviteSchema.safeParse(request.body ?? {});
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_invite' }); return; }
    const company = await prisma.managementCompany.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!company) { response.status(404).json({ code: 'company_not_found' }); return; }
    response.status(201).json(await createInvite(miniApp(response).admin!, company.id, parsed.data.role));
  } catch (error) { next(error); }
});

const transferSchema = z.object({ companyId: z.string().uuid() });

// A house changes its management company (residents chose another one at a
// general meeting). Residents and the incident history stay with the house;
// from now on the new company sees and handles it.
platformRouter.post('/buildings/:id/transfer', async (request, response, next) => {
  try {
    const parsed = transferSchema.safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_transfer' }); return; }
    const { admin } = miniApp(response);
    const result = await prisma.$transaction(async (tx) => {
      const [building, company] = await Promise.all([
        tx.building.findUnique({ where: { id: request.params.id }, select: { id: true, companyId: true } }),
        tx.managementCompany.findUnique({ where: { id: parsed.data.companyId }, select: { id: true } }),
      ]);
      if (!building || !company) return null;
      await tx.building.update({ where: { id: building.id }, data: { companyId: company.id } });
      await writeAdminAudit(tx, admin!.id, 'building_transferred', 'building', building.id, { from: building.companyId, to: company.id });
      return { from: building.companyId, to: company.id };
    });
    if (!result) { response.status(404).json({ code: 'not_found' }); return; }
    response.json(result);
  } catch (error) { next(error); }
});

platformRouter.put('/privacy', async (request, response, next) => {
  try {
    const parsed = z.object({ item: privacySchema.nullable() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_privacy' }); return; }
    const item = await savePrivacy(parsed.data.item);
    await writeAdminAudit(prisma, miniApp(response).admin!.id, 'privacy_updated', 'platform_setting', 'privacy');
    response.json({ item, custom: parsed.data.item !== null });
  } catch (error) { next(error); }
});

platformRouter.get('/privacy', async (_request, response, next) => {
  try { const item = await getPrivacy(); response.json({ item, custom: JSON.stringify(item) !== JSON.stringify(defaultPrivacy) }); } catch (error) { next(error); }
});

platformRouter.get('/duties', async (_request, response, next) => {
  try { response.json({ items: await platformDuties(), law: lawDuties }); } catch (error) { next(error); }
});

platformRouter.put('/duties', async (request, response, next) => {
  try {
    const parsed = z.object({ items: dutiesSchema.nullable() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_duties' }); return; }
    const items = await savePlatformDuties(parsed.data.items);
    await writeAdminAudit(prisma, miniApp(response).admin!.id, 'platform_duties_updated', 'platform_setting', 'duties');
    response.json({ items, law: lawDuties });
  } catch (error) { next(error); }
});

// The whole card of one company, for editing it in the web admin.
platformRouter.get('/companies/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'company_not_found' }); return; }
    const item = await prisma.managementCompany.findUnique({ where: { id: String(request.params.id) } });
    if (!item) { response.status(404).json({ code: 'company_not_found' }); return; }
    response.json({ item });
  } catch (error) { next(error); }
});

// ---------- staff of a company ----------

platformRouter.get('/companies/:id/admins', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'company_not_found' }); return; }
    const admins = await prisma.admin.findMany({
      where: { companyId: String(request.params.id) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, username: true, displayName: true, maxUserId: true, createdAt: true },
    });
    response.json({ items: admins.map((item) => ({ id: item.id, name: item.displayName ?? item.username, viaMax: Boolean(item.maxUserId), createdAt: item.createdAt })) });
  } catch (error) { next(error); }
});

// Removing an employee takes the access away: the person is no longer bound
// to the company or to their MAX account and all sessions end. The record
// itself stays, so the history of incidents and the action log keep the name.
platformRouter.delete('/admins/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'admin_not_found' }); return; }
    const target = await prisma.admin.findUnique({ where: { id: String(request.params.id) }, select: { id: true, role: true, companyId: true, displayName: true, username: true } });
    if (!target || !target.companyId) { response.status(404).json({ code: 'admin_not_found' }); return; }
    if (target.role === 'platform_admin') { response.status(409).json({ code: 'cannot_remove_platform_admin' }); return; }
    if (target.username === juryDemoUsername) { response.status(409).json({ code: 'demo_account' }); return; }
    const actor = miniApp(response).admin!;
    await prisma.$transaction((tx) => revokeAdminAccess(tx, target));
    await writeAdminAudit(prisma, actor.id, 'company_admin_removed', 'admin', target.id, { companyId: target.companyId });
    response.status(204).end();
  } catch (error) { next(error); }
});

// Deleting a company. Its houses have residents and the history of
// incidents, so they go only when asked (?withBuildings=true); otherwise a
// company with houses answers 409 with their numbers, and the houses can be
// handed to another company first. Its announcements, services and
// invitations go with it; its employees lose their access.
platformRouter.delete('/companies/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'company_not_found' }); return; }
    const company = await prisma.managementCompany.findUnique({ where: { id: String(request.params.id) }, select: { id: true, name: true, buildings: { select: { id: true } } } });
    if (!company) { response.status(404).json({ code: 'company_not_found' }); return; }
    const withBuildings = request.query.withBuildings === 'true';
    if (company.buildings.length && !withBuildings) {
      const residents = await prisma.residentMembership.count({ where: { revokedAt: null, apartment: { building: { companyId: company.id } } } });
      response.status(409).json({ code: 'company_has_buildings', buildings: company.buildings.length, residents });
      return;
    }
    const actor = miniApp(response).admin!;
    const photoIds: string[] = [];
    const removed = await prisma.$transaction(async (tx) => {
      let revokedMemberships = 0;
      let deletedIncidents = 0;
      for (const building of company.buildings) {
        const result = await deleteBuildingData(tx, building.id);
        revokedMemberships += result.revokedMemberships;
        deletedIncidents += result.deletedIncidents;
        photoIds.push(...result.photoIds);
      }
      const staff = await tx.admin.findMany({ where: { companyId: company.id }, select: { id: true, displayName: true, username: true } });
      for (const person of staff) await revokeAdminAccess(tx, person);
      await tx.managementCompany.delete({ where: { id: company.id } });
      return { buildings: company.buildings.length, revokedMemberships, deletedIncidents };
    }, { timeout: 120_000 });
    await deletePhotoFiles(photoIds);
    await writeAdminAudit(prisma, actor.id, 'company_deleted', 'company', company.id, { name: company.name, ...removed });
    response.status(204).end();
  } catch (error) { next(error); }
});
