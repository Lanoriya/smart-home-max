import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { buildingWhere, requireCompanyId, viaApartment } from '../auth/scope.js';
import { buildingSchema, createBuilding, isUsableLink } from '../buildings/building-service.js';
import { compareBuildings } from '../buildings/address.js';
import { announcementHistorySchema, announcementSchema, companyAnnouncements, deleteAnnouncement, queueAnnouncement, setAnnouncementArchived } from '../announcements/announcement-service.js';
import { getIncident, listFiltersSchema, listIncidents, patchIncidentSchema, updateIncident } from '../incidents/admin-incidents.js';
import { activeRequestsSince, decideJoinRequest, requesterName } from '../residents/join-requests.js';
import { formatRussianPhone, normalizeRussianPhone } from '../shared/phone.js';
import { companyStats } from '../stats/company-stats.js';
import { miniApp, requireMiniAppAdmin } from './auth.js';
import { createInvite } from './invites.js';
import { createWebLoginLink } from '../auth/web-link.js';
import { revokeAdminAccess } from '../auth/revoke-admin.js';
import { juryDemoUsername } from '../auth/jury-link.js';
import { buildingCodePattern } from '../buildings/access-code.js';
import { hashInviteCode } from '../users/invite-code.js';
import { env } from '../config/env.js';
import { houseLink } from '../buildings/house-link.js';
import { locateAddress } from '../registry/geosearch.js';
import { quickDialOf, quickDialSchema } from '../companies/quick-dial.js';
import { dutiesFor, dutiesSchema, platformDuties, saveCompanyDuties } from '../companies/duties.js';
import { Prisma } from '@prisma/client';
import { optionalText } from '../shared/text.js';
import { companyPollsRouter } from '../polls/polls.js';
import { companyAppointmentsRouter } from '../appointments/appointments.js';
import { companyZone } from '../shared/time-zone.js';

// The company desk inside the mini-app: the same work as the web dispatcher
// desk, limited to the administrator's own company.

export const companyRouter = Router();
companyRouter.use(requireMiniAppAdmin('dispatcher', 'supervisor'));

const admin = (response: Parameters<typeof miniApp>[0]) => miniApp(response).admin!;
const companyOf = (response: Parameters<typeof miniApp>[0]) => requireCompanyId(admin(response), response.locals.companyId);

companyRouter.get('/overview', async (_request, response, next) => {
  try {
    const companyId = companyOf(response);
    const [company, stats, pendingJoins] = await Promise.all([
      prisma.managementCompany.findUniqueOrThrow({ where: { id: companyId } }),
      companyStats(companyId),
      prisma.apartmentJoinRequest.count({ where: { status: 'pending', createdAt: { gte: activeRequestsSince() }, ...viaApartment(companyId) } }),
    ]);
    response.json({ company, stats, pendingJoins, role: admin(response).role, timeZone: await companyZone(companyId) });
  } catch (error) { next(error); }
});

// ---------- incidents ----------

companyRouter.get('/incidents', async (request, response, next) => {
  try {
    const filters = listFiltersSchema.safeParse(request.query);
    if (!filters.success) { response.status(400).json({ code: 'invalid_incident_filter' }); return; }
    response.json({ items: await listIncidents(companyOf(response), filters.data) });
  } catch (error) { next(error); }
});

companyRouter.get('/incidents/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const item = await getIncident(companyOf(response), request.params.id);
    if (!item) { response.status(404).json({ code: 'incident_not_found' }); return; }
    // MAX file tokens are of no use in the browser; only viewable photos go out.
    response.json({ item: { ...item, photos: item.photos.filter((photo) => photo.url).map(({ token: _token, ...photo }) => photo) } });
  } catch (error) { next(error); }
});

companyRouter.patch('/incidents/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const parsed = patchIncidentSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_incident_patch', details: parsed.error.flatten() }); return; }
    const result = await updateIncident(admin(response), companyOf(response), request.params.id, parsed.data);
    if (!result.ok) {
      const { status, ok: _ok, ...body } = result;
      response.status(status).json(body);
      return;
    }
    response.json({ item: result.item });
  } catch (error) { next(error); }
});

// ---------- houses ----------

companyRouter.get('/buildings', async (_request, response, next) => {
  try {
    const companyId = companyOf(response);
    const [items, open] = await Promise.all([
      prisma.building.findMany({
        where: buildingWhere(companyId),
        select: {
          id: true, address: true, street: true, house: true, entrancesCount: true, apartmentsCount: true, latitude: true, longitude: true, chatLink: true,
          _count: { select: { apartments: { where: { memberships: { some: { revokedAt: null } } } } } },
        },
      }),
      prisma.incident.groupBy({ by: ['buildingId'], where: { building: { companyId }, archivedAt: null, status: { in: ['new', 'acknowledged', 'in_progress'] } }, _count: { _all: true } }),
    ]);
    const openBy = new Map(open.map((row) => [row.buildingId, row._count._all]));
    response.json({
      items: items.sort(compareBuildings).map(({ _count, ...building }) => ({ ...building, connectedApartments: _count.apartments, openIncidents: openBy.get(building.id) ?? 0 })),
    });
  } catch (error) { next(error); }
});

companyRouter.post('/buildings', async (request, response, next) => {
  try {
    const parsed = buildingSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_building', details: parsed.error.flatten() }); return; }
    const result = await createBuilding(admin(response), companyOf(response), parsed.data);
    if (!result.ok) { response.status(409).json({ code: result.code }); return; }
    const { accessCode, ...item } = result.item;
    // The code is shown once right after creation so the company can print it.
    response.status(201).json({ item, accessCode });
  } catch (error) { next(error); }
});

const pointSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

// Moving the pin of a house on the map.
companyRouter.patch('/buildings/:id/location', async (request, response, next) => {
  try {
    const parsed = pointSchema.safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_location' }); return; }
    const companyId = companyOf(response);
    const changed = await prisma.$transaction(async (tx) => {
      const result = await tx.building.updateMany({ where: { id: String(request.params.id), companyId }, data: parsed.data });
      if (result.count) await writeAdminAudit(tx, admin(response).id, 'building_moved', 'building', request.params.id, parsed.data);
      return result.count;
    });
    if (!changed) { response.status(404).json({ code: 'building_not_found' }); return; }
    response.json({ ok: true });
  } catch (error) { next(error); }
});

companyRouter.get('/buildings/:id/code', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'building_not_found' }); return; }
    response.setHeader('Cache-Control', 'no-store');
    const building = await prisma.building.findFirst({ where: { id: String(request.params.id), companyId: companyOf(response) }, select: { id: true, accessCode: true } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    await writeAdminAudit(prisma, admin(response).id, 'building_code_revealed', 'building', building.id);
    response.json({ code: building.accessCode });
  } catch (error) { next(error); }
});

// The link for the QR code at the entrance: the bot opens with this house chosen.
companyRouter.get('/buildings/:id/resident-link', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'building_not_found' }); return; }
    const building = await prisma.building.findFirst({ where: { id: String(request.params.id), companyId: companyOf(response) }, select: { id: true, address: true, company: { select: { name: true, phone: true } } } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    const link = houseLink(building.id);
    if (!link) { response.status(409).json({ code: 'bot_username_missing' }); return; }
    response.json({ link, address: building.address, companyName: building.company.name, companyPhone: building.company.phone });
  } catch (error) { next(error); }
});

// ---------- residents ----------

companyRouter.post('/announcements', async (request, response, next) => {
  try {
    const parsed = announcementSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_announcement', details: parsed.error.flatten() }); return; }
    const result = await queueAnnouncement(admin(response), companyOf(response), parsed.data);
    if (!result.ok) { response.status(404).json({ code: result.code }); return; }
    response.status(202).json({ recipientsCount: result.recipientsCount });
  } catch (error) { next(error); }
});

companyRouter.get('/announcements', async (request, response, next) => {
  try {
    const parsed = announcementHistorySchema.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_announcement_query' }); return; }
    response.json(await companyAnnouncements(companyOf(response), parsed.data.archived === 'true', parsed.data.page));
  } catch (error) { next(error); }
});

for (const [action, archived] of [['archive', true], ['restore', false]] as const) {
  companyRouter.post(`/announcements/:id/${action}`, async (request, response, next) => {
    try {
      if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'announcement_not_found' }); return; }
      if (!await setAnnouncementArchived(admin(response).id, companyOf(response), String(request.params.id), archived)) { response.status(404).json({ code: 'announcement_not_found' }); return; }
      response.status(204).end();
    } catch (error) { next(error); }
  });
}

companyRouter.delete('/announcements/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'announcement_not_found' }); return; }
    if (!await deleteAnnouncement(admin(response).id, companyOf(response), String(request.params.id))) { response.status(404).json({ code: 'announcement_not_found' }); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});

companyRouter.get('/join-requests', async (_request, response, next) => {
  try {
    const items = await prisma.apartmentJoinRequest.findMany({
      where: { status: 'pending', createdAt: { gte: activeRequestsSince() }, ...viaApartment(companyOf(response)) },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { displayName: true, maxUsername: true } }, apartment: { select: { number: true, building: { select: { address: true } } } } },
    });
    response.json({
      items: items.map((item) => ({
        id: item.id, createdAt: item.createdAt, requesterName: requesterName(item.user.displayName, item.user.maxUsername),
        apartmentNumber: item.apartment.number, address: item.apartment.building.address,
      })),
    });
  } catch (error) { next(error); }
});

companyRouter.post('/join-requests/:id/:decision', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    const decision = z.enum(['approve', 'reject']).safeParse(request.params.decision);
    if (!id.success || !decision.success) { response.status(404).json({ code: 'not_found' }); return; }
    const own = await prisma.apartmentJoinRequest.findFirst({ where: { id: id.data, ...viaApartment(companyOf(response)) }, select: { id: true } });
    if (!own) { response.status(404).json({ code: 'not_found' }); return; }
    const actor = admin(response);
    const result = await decideJoinRequest(id.data, decision.data, { adminId: actor.id });
    if (!result.ok) { response.status(409).json({ code: result.reason }); return; }
    await writeAdminAudit(prisma, actor.id, decision.data === 'approve' ? 'join_request_approved' : 'join_request_rejected', 'apartment_join_request', id.data);
    response.json({ status: result.status });
  } catch (error) { next(error); }
});

// ---------- company card and team ----------


export const companyCardSchema = z.object({
  name: z.string().trim().min(2).max(200),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})$/).nullable().optional().or(z.literal('')).transform((value) => value || null),
  ogrn: z.string().trim().regex(/^(\d{13}|\d{15})$/).nullable().optional().or(z.literal('')).transform((value) => value || null),
  site: optionalText(300),
  phone: z.string().trim().max(60).transform((value, context) => {
    // Phones from the open registry come in many forms ("8(3435)97-84-34",
    // two numbers in one field): the first Russian number is taken and
    // written the same way for everyone, +7 (XXX) XXX-XX-XX.
    const normalized = normalizeRussianPhone(value)
      ?? (value.match(/\+?[78]?[\s(.-]*\d[\d\s().-]{8,}\d/g) ?? []).map((part) => normalizeRussianPhone(part.trim())).find(Boolean)
      ?? null;
    if (!normalized) {
      context.addIssue({ code: 'custom', message: 'Expected a Russian phone number' });
      return z.NEVER;
    }
    return formatRussianPhone(normalized);
  }),
  email: z.union([z.literal(''), z.null(), z.string().trim().max(200).email()]).optional().transform((value) => value || null),
  address: optionalText(300),
  workingHours: optionalText(300),
  receptionHours: optionalText(300),
  daysOff: optionalText(200),
  cleaningInfo: optionalText(1500),
  note: optionalText(1000),
  latitude: z.number().min(-90).max(90).nullable().optional().transform((value) => value ?? null),
  longitude: z.number().min(-180).max(180).nullable().optional().transform((value) => value ?? null),
});

// The office is put on the map by its address when nobody tapped the map.
export async function withOfficePoint<T extends { address: string | null; latitude: number | null; longitude: number | null }>(card: T): Promise<T> {
  if (card.latitude != null && card.longitude != null || !card.address) return card;
  const point = await locateAddress(card.address);
  return point ? { ...card, ...point } : card;
}

companyRouter.put('/company', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = companyCardSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_company', details: parsed.error.flatten() }); return; }
    const companyId = companyOf(response);
    const card = await withOfficePoint(parsed.data);
    const item = await prisma.$transaction(async (tx) => {
      const saved = await tx.managementCompany.update({ where: { id: companyId }, data: card });
      await writeAdminAudit(tx, admin(response).id, 'company_updated', 'management_company', companyId);
      return saved;
    });
    response.json({ item });
  } catch (error) { next(error); }
});

companyRouter.get('/team', requireMiniAppAdmin('supervisor'), async (_request, response, next) => {
  try {
    const me = admin(response).id;
    const items = await prisma.admin.findMany({
      where: { companyId: companyOf(response) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, displayName: true, username: true, maxUserId: true, createdAt: true },
    });
    response.json({ items: items.map(({ maxUserId, ...item }) => ({ ...item, viaMax: Boolean(maxUserId), isYou: item.id === me, removable: item.id !== me && item.username !== juryDemoUsername })) });
  } catch (error) { next(error); }
});

// A supervisor removes an employee of their company: the access ends at once,
// the record stays for the history of incidents (see revokeAdminAccess).
// Leaving oneself goes through POST /leave.
companyRouter.delete('/team/:id', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'admin_not_found' }); return; }
    const actor = admin(response);
    const companyId = companyOf(response);
    const target = await prisma.admin.findFirst({ where: { id: String(request.params.id), companyId }, select: { id: true, role: true, displayName: true, username: true } });
    if (!target) { response.status(404).json({ code: 'admin_not_found' }); return; }
    if (target.id === actor.id) { response.status(409).json({ code: 'cannot_remove_yourself' }); return; }
    if (target.role === 'platform_admin') { response.status(409).json({ code: 'cannot_remove_platform_admin' }); return; }
    if (target.username === juryDemoUsername) { response.status(409).json({ code: 'demo_account' }); return; }
    await prisma.$transaction((tx) => revokeAdminAccess(tx, target));
    await writeAdminAudit(prisma, actor.id, 'company_admin_removed', 'admin', target.id, { companyId });
    response.status(204).end();
  } catch (error) { next(error); }
});

// One role for all company staff; an old client may still send "dispatcher".
const inviteSchema = z.object({ role: z.enum(['dispatcher', 'supervisor']).transform(() => 'supervisor' as const) });

companyRouter.post('/invites', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_invite' }); return; }
    response.status(201).json(await createInvite(admin(response), companyOf(response), parsed.data.role));
  } catch (error) { next(error); }
});

// The web desk of the same company for a computer: a one-time link valid for
// five minutes signs the employee in without a password — MAX already told
// who they are. Each company sees only its own houses and incidents there.
companyRouter.post('/web-link', async (_request, response, next) => {
  try {
    // Company staff open their company; the platform administrator opens the
    // whole platform and may switch to any company there.
    response.status(201).json({ url: await createWebLoginLink(admin(response).id) });
  } catch (error) { next(error); }
});

// Polls and the reception of citizens live in their own modules.
companyRouter.use('/polls', companyPollsRouter);
companyRouter.use('/appointments', companyAppointmentsRouter);

// ---------- numbers residents call ----------
// The company keeps its quick dial row and its emergency services; the
// city-wide services of the platform are not edited here.

companyRouter.get('/services', async (_request, response, next) => {
  try {
    const companyId = companyOf(response);
    const [company, items] = await Promise.all([
      prisma.managementCompany.findUniqueOrThrow({ where: { id: companyId }, select: { quickDial: true } }),
      prisma.emergencyService.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true, description: true } }),
    ]);
    response.json({ quickDial: quickDialOf(company.quickDial), customQuickDial: company.quickDial != null, items });
  } catch (error) { next(error); }
});

companyRouter.put('/quick-dial', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = z.object({ items: quickDialSchema.min(1).nullable() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_quick_dial' }); return; }
    const companyId = companyOf(response);
    await prisma.managementCompany.update({ where: { id: companyId }, data: { quickDial: parsed.data.items ?? Prisma.DbNull } });
    await writeAdminAudit(prisma, admin(response).id, 'quick_dial_updated', 'management_company', companyId);
    response.json({ quickDial: quickDialOf(parsed.data.items) });
  } catch (error) { next(error); }
});

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(3).max(50),
  description: z.string().trim().min(2).max(400),
});

companyRouter.post('/services', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = serviceSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_emergency_service' }); return; }
    const companyId = companyOf(response);
    if (await prisma.emergencyService.count({ where: { companyId } }) >= 30) { response.status(409).json({ code: 'too_many_services' }); return; }
    const item = await prisma.emergencyService.create({ data: { ...parsed.data, companyId }, select: { id: true, name: true, phone: true, description: true } });
    await writeAdminAudit(prisma, admin(response).id, 'emergency_service_created', 'emergency_service', item.id);
    response.status(201).json({ item });
  } catch (error) { next(error); }
});

companyRouter.patch('/services/:id', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = serviceSchema.safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_emergency_service' }); return; }
    const exists = await prisma.emergencyService.findFirst({ where: { id: String(request.params.id), companyId: companyOf(response) }, select: { id: true } });
    if (!exists) { response.status(404).json({ code: 'emergency_service_not_found' }); return; }
    const item = await prisma.emergencyService.update({ where: { id: exists.id }, data: parsed.data, select: { id: true, name: true, phone: true, description: true } });
    await writeAdminAudit(prisma, admin(response).id, 'emergency_service_updated', 'emergency_service', exists.id);
    response.json({ item });
  } catch (error) { next(error); }
});

companyRouter.delete('/services/:id', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'emergency_service_not_found' }); return; }
    const exists = await prisma.emergencyService.findFirst({ where: { id: String(request.params.id), companyId: companyOf(response) }, select: { id: true } });
    if (!exists) { response.status(404).json({ code: 'emergency_service_not_found' }); return; }
    await prisma.emergencyService.delete({ where: { id: exists.id } });
    await writeAdminAudit(prisma, admin(response).id, 'emergency_service_deleted', 'emergency_service', exists.id);
    response.status(204).end();
  } catch (error) { next(error); }
});

companyRouter.get('/duties', async (_request, response, next) => {
  try {
    const current = await dutiesFor(companyOf(response));
    response.json({ ...current, platform: await platformDuties() });
  } catch (error) { next(error); }
});

companyRouter.put('/duties', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = z.object({ items: dutiesSchema.nullable() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_duties' }); return; }
    const companyId = companyOf(response);
    const saved = await saveCompanyDuties(companyId, parsed.data.items);
    await writeAdminAudit(prisma, admin(response).id, 'duties_updated', 'management_company', companyId);
    response.json(saved);
  } catch (error) { next(error); }
});

// An employee leaves the company themselves (for example, moved to another
// job): the access to the desk ends at once.
companyRouter.post('/leave', async (_request, response, next) => {
  try {
    const actor = admin(response);
    if (actor.role === 'platform_admin') { response.status(409).json({ code: 'cannot_remove_platform_admin' }); return; }
    const record = await prisma.admin.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, displayName: true, username: true, companyId: true } });
    await prisma.$transaction((tx) => revokeAdminAccess(tx, record));
    await writeAdminAudit(prisma, actor.id, 'company_admin_left', 'admin', actor.id, { companyId: record.companyId });
    response.status(204).end();
  } catch (error) { next(error); }
});

// Reminders of the legal terms in MAX, for this employee only.
companyRouter.put('/legal-reminders', async (request, response, next) => {
  try {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_setting' }); return; }
    const actor = admin(response);
    if (actor.role === 'platform_admin') { response.status(409).json({ code: 'not_company_staff' }); return; }
    await prisma.admin.update({ where: { id: actor.id }, data: { legalReminders: parsed.data.enabled } });
    response.json({ enabled: parsed.data.enabled });
  } catch (error) { next(error); }
});

// ---------- codes of houses and apartments ----------

companyRouter.patch('/buildings/:id/code', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = z.object({ code: z.string().trim().transform((value) => value.replace(/\s/g, '')).pipe(z.string().regex(buildingCodePattern)) }).safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_building_code' }); return; }
    const changed = await prisma.building.updateMany({ where: { id: String(request.params.id), companyId: companyOf(response) }, data: { accessCode: parsed.data.code } });
    if (!changed.count) { response.status(404).json({ code: 'building_not_found' }); return; }
    await writeAdminAudit(prisma, admin(response).id, 'building_code_changed', 'building', String(request.params.id));
    response.json({ code: parsed.data.code });
  } catch (error) { next(error); }
});

// Apartments of a house by their number: houses have hundreds of them.
companyRouter.get('/buildings/:id/apartments', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'building_not_found' }); return; }
    const building = await prisma.building.findFirst({ where: { id: String(request.params.id), companyId: companyOf(response) }, select: { id: true } });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    const query = String(request.query.q ?? '').trim();
    const apartments = await prisma.apartment.findMany({
      where: { buildingId: building.id, ...(query ? { number: { startsWith: query, mode: 'insensitive' } } : {}) },
      select: {
        id: true, number: true, inviteCodeHash: true, contractNumber: true,
        memberships: { where: { revokedAt: null }, select: { user: { select: { displayName: true, maxUsername: true, sharedPhone: true } } } },
      },
    });
    apartments.sort((left, right) => left.number.localeCompare(right.number, 'ru', { numeric: true }));
    // Given in portions of 30: the list loads more while it is scrolled.
    const offset = Math.max(0, Number(request.query.offset ?? 0) || 0);
    response.json({
      total: apartments.length,
      items: apartments.slice(offset, offset + 30).map((apartment) => ({
        id: apartment.id, number: apartment.number, hasCode: Boolean(apartment.inviteCodeHash),
        contractNumber: apartment.contractNumber, residents: apartment.memberships.length,
        // Who lives there in the service: the name from MAX and the phone if shared.
        people: apartment.memberships.map(({ user }) => [user.displayName ?? (user.maxUsername ? `@${user.maxUsername}` : 'Житель без имени в MAX'), user.sharedPhone].filter(Boolean).join(', ')),
      })),
    });
  } catch (error) { next(error); }
});

const apartmentCodesSchema = z.object({
  // A personal apartment code (it is stored only as a hash) or null to remove it.
  code: z.string().trim().min(6).max(64).nullable().optional(),
  contractNumber: z.string().trim().max(40).transform((value) => value.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[0-9A-Za-zА-Яа-я/]{4,30}$/)).optional(),
}).refine((value) => value.code !== undefined || value.contractNumber !== undefined, { message: 'Nothing to change' });

companyRouter.patch('/apartments/:id', requireMiniAppAdmin('supervisor'), async (request, response, next) => {
  try {
    const parsed = apartmentCodesSchema.safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_apartment_codes' }); return; }
    const apartment = await prisma.apartment.findFirst({ where: { id: String(request.params.id), building: { companyId: companyOf(response) } }, select: { id: true } });
    if (!apartment) { response.status(404).json({ code: 'apartment_not_found' }); return; }
    await prisma.apartment.update({
      where: { id: apartment.id },
      data: {
        ...(parsed.data.code === undefined ? {} : { inviteCodeHash: parsed.data.code === null ? null : hashInviteCode(parsed.data.code, env.APARTMENT_CODE_PEPPER) }),
        ...(parsed.data.contractNumber === undefined ? {} : { contractNumber: parsed.data.contractNumber }),
      },
    });
    await writeAdminAudit(prisma, admin(response).id, 'apartment_codes_changed', 'apartment', apartment.id, { code: parsed.data.code === undefined ? 'kept' : parsed.data.code === null ? 'removed' : 'set', contractNumber: parsed.data.contractNumber !== undefined });
    response.status(204).end();
  } catch (error) { next(error); }
});

// The link to the chat of the house in MAX: residents get a "Чат дома" button
// in the app and in the bot. An empty value removes it.
companyRouter.patch('/buildings/:id/chat', async (request, response, next) => {
  try {
    const parsed = z.object({ chatLink: z.string().trim().max(500).nullable() }).safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_chat_link' }); return; }
    const chatLink = parsed.data.chatLink || null;
    if (chatLink && !isUsableLink(chatLink)) { response.status(400).json({ code: 'invalid_chat_link' }); return; }
    const changed = await prisma.building.updateMany({ where: { id: String(request.params.id), companyId: companyOf(response) }, data: { chatLink } });
    if (!changed.count) { response.status(404).json({ code: 'building_not_found' }); return; }
    await writeAdminAudit(prisma, admin(response).id, 'building_chat_changed', 'building', String(request.params.id));
    response.json({ chatLink });
  } catch (error) { next(error); }
});
