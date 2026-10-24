import { randomUUID } from 'node:crypto';
import { apartmentNumberWhere, normalizeApartmentNumber } from '../shared/apartment-number.js';
import { Router } from 'express';
import { z } from 'zod';
import { quickDialOf } from '../companies/quick-dial.js';
import { dutiesFor } from '../companies/duties.js';
import { legalTermOf } from '../incidents/legal-terms.js';
import type { IncidentCategory, Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { env } from '../config/env.js';
import { buildingCodeMatches } from '../buildings/access-code.js';
import { inviteCodeMatches } from '../users/invite-code.js';
import { bindResident, cancelJoinRequest, createJoinRequest, otherResidentsCount, pendingJoinRequest, leaveApartment } from '../residents/join-requests.js';
import {
  cancelResidentReport,
  categoryValues,
  createIncidentFromReport,
  findMatchingIncidents,
  joinPublicIncident,
  zonesByCategory,
} from '../incidents/incident-service.js';
import { miniApp } from './auth.js';
import { unvotedPolls } from '../polls/polls.js';
import { buildingZone, companyZone } from '../shared/time-zone.js';
import { codeAttemptsLeft, registerCodeFailure } from '../residents/code-attempts.js';
import { canClearApartmentData, clearApartmentData } from '../residents/apartment-data.js';
import { feedbackSchema, feedbackState, giveFeedback } from '../incidents/resident-feedback.js';
import { contractKey } from '../shared/contract.js';

// What a resident does in the mini-app. The rules are the bot's rules: the
// same codes, the same shared incidents, the same privacy of apartment issues.

export const residentRouter = Router();

const activeStatuses = ['new', 'acknowledged', 'in_progress'] as const;
const apartmentCategories: IncidentCategory[] = ['water', 'electricity', 'heating', 'leak', 'other'];
const commonZones = ['entrance', 'elevator', 'yard', 'common'] as const;

function membershipOf(userId: string) {
  return prisma.residentMembership.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { verifiedAt: 'desc' },
    include: {
      apartment: {
        include: {
          building: {
            select: {
              id: true, address: true, street: true, house: true, entrancesCount: true, chatLink: true, latitude: true, longitude: true, companyId: true, city: true,
              company: { select: { id: true, name: true, phone: true, email: true, address: true, workingHours: true, receptionHours: true, daysOff: true, cleaningInfo: true, note: true, latitude: true, longitude: true, quickDial: true } },
            },
          },
        },
      },
    },
  });
}

type Membership = NonNullable<Awaited<ReturnType<typeof membershipOf>>>;

residentRouter.get('/me', async (_request, response, next) => {
  try {
    const { user, admin } = miniApp(response);
    const [membership, pending, profile, adminRecord] = await Promise.all([
      membershipOf(user.id),
      pendingJoinRequest(user.id),
      prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true, maxUsername: true, sharedPhone: true, consentAt: true } }),
      admin ? prisma.admin.findUnique({ where: { id: admin.id }, select: { role: true, legalReminders: true, company: { select: { id: true, name: true } } } }) : null,
    ]);
    const adminZone = adminRecord?.company ? await companyZone(adminRecord.company.id) : null;
    response.json({
      user: { id: user.id, displayName: profile?.displayName ?? null, username: profile?.maxUsername ?? null, phone: profile?.sharedPhone ?? null, consent: Boolean(profile?.consentAt) },
      residence: membership ? residence(membership) : null,
      pendingJoin: pending ? { address: pending.apartment.building.address, apartmentNumber: pending.apartment.number, createdAt: pending.createdAt } : null,
      admin: adminRecord ? { role: adminRecord.role, company: adminRecord.company, timeZone: adminZone, legalReminders: adminRecord.legalReminders } : null,
      botUsername: env.MAX_BOT_USERNAME ?? null,
    });
  } catch (error) { next(error); }
});

function residence(membership: Membership) {
  const { building } = membership.apartment;
  return {
    apartmentId: membership.apartmentId,
    apartmentNumber: membership.apartment.number,
    building: {
      id: building.id, address: building.address, street: building.street, house: building.house, entrancesCount: building.entrancesCount, chatLink: building.chatLink,
      latitude: building.latitude, longitude: building.longitude,
    },
    company: building.company,
    // Dates of the house are shown on its clock.
    timeZone: buildingZone(building),
  };
}

// The public map: houses connected to the service and the companies managing
// them. Only counts of open common issues are shown, never their texts.
residentRouter.get('/map', async (_request, response, next) => {
  try {
    const [companies, buildings, openByBuilding] = await Promise.all([
      prisma.managementCompany.findMany({
        select: { id: true, name: true, phone: true, address: true, workingHours: true, latitude: true, longitude: true, _count: { select: { buildings: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.building.findMany({ select: { id: true, address: true, companyId: true, latitude: true, longitude: true } }),
      prisma.incident.groupBy({
        by: ['buildingId'],
        where: { status: { in: [...activeStatuses] }, archivedAt: null, locationZone: { not: 'apartment' } },
        _count: { _all: true },
      }),
    ]);
    const open = new Map(openByBuilding.map((row) => [row.buildingId, row._count._all]));
    response.json({
      companies: companies.map(({ _count, ...company }) => ({ ...company, buildingsCount: _count.buildings })),
      buildings: buildings.map((building) => ({ ...building, openIssues: open.get(building.id) ?? 0 })),
    });
  } catch (error) { next(error); }
});

residentRouter.get('/buildings/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) { response.status(404).json({ code: 'building_not_found' }); return; }
    const building = await prisma.building.findUnique({
      where: { id: id.data },
      select: {
        id: true, address: true, entrancesCount: true, apartmentsCount: true, latitude: true, longitude: true,
        company: { select: { id: true, name: true, phone: true, email: true, address: true, workingHours: true, receptionHours: true, daysOff: true } },
        _count: { select: { apartments: { where: { memberships: { some: { revokedAt: null } } } } } },
      },
    });
    if (!building) { response.status(404).json({ code: 'building_not_found' }); return; }
    const membership = await membershipOf(miniApp(response).user.id);
    const isResident = membership?.apartment.buildingId === building.id;
    const incidents = await prisma.incident.findMany({
      where: { buildingId: building.id, status: { in: [...activeStatuses] }, archivedAt: null, locationZone: { not: 'apartment' } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, number: true, title: true, category: true, locationZone: true, entranceNumber: true, status: true, createdAt: true, _count: { select: { reports: true } } },
    });
    const { _count, ...rest } = building;
    response.json({
      item: {
        ...rest,
        connectedApartments: _count.apartments,
        isResident,
        // Texts of issues are visible to residents of the house only.
        openIssues: incidents.map(({ _count: counts, title, ...incident }) => ({ ...incident, title: isResident ? title : null, reportsCount: counts.reports })),
      },
    });
  } catch (error) { next(error); }
});

// The apartment is proved by the codes the company gives (house code, then
// the apartment code) or by the number of the management contract.
const residenceSchema = z.object({
  buildingId: z.string().uuid(),
  apartmentNumber: z.string().trim().min(1).max(20),
  buildingCode: z.string().trim().max(30).optional(),
  apartmentCode: z.string().trim().max(64).optional(),
  contractNumber: z.string().trim().max(40).optional(),
  // The resident agreed to the processing of personal data on this screen.
  consent: z.boolean().optional(),
}).refine((value) => Boolean(value.buildingCode) || Boolean(value.contractNumber), { message: 'A house code or a contract number is required' });

const contractDigits = contractKey;

// Connecting to an apartment: the code of the house, then the personal code
// of the apartment if the company set one, or approval of the residents who
// are already connected there.
residentRouter.post('/residence', async (request, response, next) => {
  try {
    const parsed = residenceSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_residence' }); return; }
    const { user } = miniApp(response);
    const agreed = await prisma.user.findUnique({ where: { id: user.id }, select: { consentAt: true } });
    if (!agreed?.consentAt && !parsed.data.consent) { response.status(400).json({ code: 'consent_required' }); return; }
    if (!agreed?.consentAt) await prisma.user.update({ where: { id: user.id }, data: { consentAt: new Date() } });
    if (await codeAttemptsLeft(user.id) === 0) { response.status(429).json({ code: 'too_many_attempts' }); return; }

    const apartmentNumber = normalizeApartmentNumber(parsed.data.apartmentNumber);
    if (!apartmentNumber) { response.status(404).json({ code: 'apartment_not_found' }); return; }
    const apartment = await prisma.apartment.findFirst({
      where: { buildingId: parsed.data.buildingId, ...apartmentNumberWhere(apartmentNumber) },
      select: { id: true, number: true, inviteCodeHash: true, contractNumber: true, building: { select: { accessCode: true } } },
    });
    if (!apartment) { response.status(404).json({ code: 'apartment_not_found' }); return; }

    const fail = async (code: string) => {
      response.status(403).json({ code, attemptsLeft: await registerCodeFailure(user.id) });
    };
    // The contract of the apartment is checked first: it is enough to
    // connect. A code typed in the house code field that is the contract
    // number of this apartment counts as the contract.
    const byContract = parsed.data.contractNumber
      ?? (parsed.data.buildingCode && apartment.contractNumber && contractDigits(parsed.data.buildingCode) === contractDigits(apartment.contractNumber) ? parsed.data.buildingCode : null);
    if (byContract) {
      if (contractDigits(byContract) !== contractDigits(apartment.contractNumber)) { await fail('wrong_contract_number'); return; }
      const { stoppedSubscriptions } = await prisma.$transaction((tx) => bindResident(tx, user.id, apartment.id));
      response.json({ status: 'bound', stoppedSubscriptions });
      return;
    }
    if (!buildingCodeMatches(parsed.data.buildingCode ?? '', apartment.building.accessCode)) { await fail('wrong_building_code'); return; }
    if (apartment.inviteCodeHash) {
      if (!parsed.data.apartmentCode) { response.json({ status: 'apartment_code_required' }); return; }
      if (!inviteCodeMatches(parsed.data.apartmentCode, apartment.inviteCodeHash, env.APARTMENT_CODE_PEPPER)) { await fail('wrong_apartment_code'); return; }
    } else if (await otherResidentsCount(apartment.id, user.id) > 0) {
      // The house code is known to every neighbour, so it is not enough to
      // join an apartment where somebody already lives.
      const { notified } = await createJoinRequest(user.id, apartment.id);
      response.json({ status: 'join_requested', notified });
      return;
    }
    const { stoppedSubscriptions } = await prisma.$transaction((tx) => bindResident(tx, user.id, apartment.id));
    response.json({ status: 'bound', stoppedSubscriptions });
  } catch (error) { next(error); }
});

residentRouter.delete('/residence', async (_request, response, next) => {
  try {
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.json({ apartmentId: null, canClearData: false }); return; }
    await prisma.$transaction((tx) => leaveApartment(tx, user.id, membership.apartmentId));
    // The last resident may also erase the names, phones and cars of the
    // apartment, so the next residents do not see them.
    response.json({ apartmentId: membership.apartmentId, canClearData: await canClearApartmentData(user.id, membership.apartmentId) });
  } catch (error) { next(error); }
});

residentRouter.post('/residence/clear', async (request, response, next) => {
  try {
    const parsed = z.object({ apartmentId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_apartment' }); return; }
    const { user } = miniApp(response);
    if (!await canClearApartmentData(user.id, parsed.data.apartmentId)) { response.status(409).json({ code: 'cannot_clear_apartment' }); return; }
    await prisma.$transaction((tx) => clearApartmentData(tx, parsed.data.apartmentId));
    response.status(204).end();
  } catch (error) { next(error); }
});

residentRouter.delete('/join-request', async (_request, response, next) => {
  try {
    await cancelJoinRequest(miniApp(response).user.id);
    response.status(204).end();
  } catch (error) { next(error); }
});

// ---------- incidents ----------

const listSchema = z.object({ scope: z.enum(['mine', 'building', 'archive']).default('mine') });

// Finished incidents: resolved or rejected by the company, and those the
// resident withdrew (their report is deleted then, only the event is left).
function archiveOf(userId: string): Prisma.IncidentWhereInput {
  return {
    OR: [
      { reports: { some: { authorUserId: userId } }, OR: [{ archivedAt: { not: null } }, { status: { in: ['resolved', 'rejected'] } }] },
      { events: { some: { actorUserId: userId, type: 'resident_report_cancelled' } }, reports: { none: { authorUserId: userId } } },
    ],
  };
}

residentRouter.get('/incidents', async (request, response, next) => {
  try {
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_scope' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (parsed.data.scope === 'building' && !membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const where: Prisma.IncidentWhereInput = parsed.data.scope === 'archive'
      ? archiveOf(user.id)
      : parsed.data.scope === 'mine'
      ? { reports: { some: { authorUserId: user.id } }, archivedAt: null, status: { in: [...activeStatuses] } }
      : { buildingId: membership!.apartment.buildingId, locationZone: { not: 'apartment' }, archivedAt: null, status: { in: [...activeStatuses] } };
    const items = await prisma.incident.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
      include: {
        building: { select: { address: true, city: true, longitude: true } },
        reports: { where: { authorUserId: user.id }, select: { id: true } },
        _count: { select: { reports: true, comments: true } },
      },
    });
    response.json({ items: items.map((incident) => incidentSummary(incident, user.id)) });
  } catch (error) { next(error); }
});

function incidentSummary(incident: Prisma.IncidentGetPayload<{ include: { building: { select: { address: true; city: true; longitude: true } }; reports: { select: { id: true } }; _count: { select: { reports: true; comments: true } } } }>, _userId: string) {
  return {
    id: incident.id,
    number: incident.number,
    title: incident.title,
    category: incident.category,
    locationZone: incident.locationZone,
    entranceNumber: incident.entranceNumber,
    status: incident.status,
    priority: incident.priority,
    dueAt: incident.dueAt,
    address: incident.building.address,
    timeZone: buildingZone(incident.building),
    reportsCount: incident._count.reports,
    commentsCount: incident._count.comments,
    joined: incident.reports.length > 0,
    archived: Boolean(incident.archivedAt),
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}

// A resident sees incidents they reported and the common incidents of their
// own house; an apartment incident stays private to the people who reported it.
async function visibleIncident(userId: string, where: Prisma.IncidentWhereInput) {
  const membership = await membershipOf(userId);
  return prisma.incident.findFirst({
    where: {
      AND: [where, {
        OR: [
          { reports: { some: { authorUserId: userId } } },
          { events: { some: { actorUserId: userId, type: 'resident_report_cancelled' } } },
          ...(membership ? [{ buildingId: membership.apartment.buildingId, locationZone: { not: 'apartment' } }] : []),
        ],
      }],
    },
    include: {
      building: { select: { address: true, city: true, longitude: true } },
      reports: { orderBy: { createdAt: 'asc' }, select: { authorUserId: true, description: true, createdAt: true, apartment: { select: { number: true } } } },
      events: { where: { type: { in: ['incident_updated', 'resident_reopened', 'incident_registered_by_phone'] } }, orderBy: { createdAt: 'asc' }, select: { type: true, payload: true, createdAt: true } },
      comments: { orderBy: { createdAt: 'asc' }, take: 50, select: { id: true, text: true, createdAt: true, authorUserId: true, apartment: { select: { number: true } } } },
      photos: { where: { url: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, url: true } },
    },
  });
}

residentRouter.get('/incidents/:ref', async (request, response, next) => {
  try {
    // The bot opens the mini-app with "incident_<number>", the app itself
    // navigates by id; both are accepted.
    const ref = request.params.ref;
    const where = /^\d{1,9}$/.test(ref) ? { number: Number(ref) } : z.string().uuid().safeParse(ref).success ? { id: ref } : null;
    if (!where) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const { user } = miniApp(response);
    const incident = await visibleIncident(user.id, where);
    if (!incident) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const mine = incident.reports.find((report) => report.authorUserId === user.id);
    const isClosed = incident.status === 'resolved' || incident.status === 'rejected';
    const timeZone = buildingZone(incident.building);
    const feedback = await feedbackState(user.id, incident, Boolean(mine));
    response.json({
      item: {
        id: incident.id,
        number: incident.number,
        title: incident.title,
        category: incident.category,
        locationZone: incident.locationZone,
        entranceNumber: incident.entranceNumber,
        apartmentNumber: incident.apartmentNumber,
        status: incident.status,
        priority: incident.priority,
        dueAt: incident.dueAt,
        delayReason: incident.delayReason,
        rejectionReason: incident.rejectionReason,
        address: incident.building.address,
        createdAt: incident.createdAt,
        resolvedAt: incident.resolvedAt,
        timeZone,
        legalTerm: legalTermOf({ ...incident, timeZone }),
        reportsCount: incident.reports.length,
        myDescription: mine?.description ?? null,
        joined: Boolean(mine),
        canJoin: !mine && !isClosed && !incident.archivedAt && incident.locationZone !== 'apartment',
        canCancel: Boolean(mine) && !isClosed,
        canComment: incident.locationZone !== 'apartment' && !incident.archivedAt,
        byPhone: incident.source === 'phone',
        // "Is the problem gone?" after the company marked it resolved.
        feedback,
        // What the company said and did, in order: the status line of the card.
        // The words of a resident who returned the incident stay with the
        // company: neighbours see only that it went back to work.
        timeline: incident.events.map((event) => {
          if (event.type === 'resident_reopened') return { at: event.createdAt, status: 'in_progress', comment: 'Житель сообщил, что проблема не решена', dueAt: null, delayReason: null };
          if (event.type === 'incident_registered_by_phone') return { at: event.createdAt, status: 'acknowledged', comment: 'Диспетчер принял заявку по телефону', dueAt: null, delayReason: null };
          const payload = event.payload as { newStatus?: string; publicComment?: string | null; newDueAt?: string | null; delayReason?: string | null };
          return { at: event.createdAt, status: payload.newStatus ?? null, comment: payload.publicComment ?? null, dueAt: payload.newDueAt ?? null, delayReason: payload.delayReason ?? null };
        }),
        comments: incident.comments.map((comment) => ({ id: comment.id, text: comment.text, createdAt: comment.createdAt, apartmentNumber: comment.apartment?.number ?? null, mine: comment.authorUserId === user.id })),
        photos: incident.photos.map((photo) => ({ id: photo.id, url: photo.url })),
      },
    });
  } catch (error) { next(error); }
});

const draftSchema = z.object({
  scope: z.enum(['building', 'apartment']),
  category: z.enum(categoryValues as [IncidentCategory, ...IncidentCategory[]]),
  locationZone: z.enum(commonZones).optional(),
  entranceNumber: z.number().int().min(1).max(50).optional(),
  description: z.string().trim().min(5).max(500),
  priority: z.enum(['normal', 'high', 'emergency']).optional(),
  // Up to three photos, made smaller by the app (about 100–300 KB each).
  photos: z.array(z.string().max(800_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)).max(3).optional(),
});

const appPhotos = (photos: string[] | undefined) => (photos ?? []).map((url) => ({ token: `app:${randomUUID()}`, url }));

type DraftResult = { ok: true; draft: Parameters<typeof createIncidentFromReport>[1] } | { ok: false; code: string };

async function toDraft(userId: string, body: unknown): Promise<DraftResult> {
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 'invalid_incident' };
  const membership = await membershipOf(userId);
  if (!membership) return { ok: false, code: 'residence_required' };
  const data = parsed.data;
  if (data.scope === 'apartment') {
    if (!apartmentCategories.includes(data.category)) return { ok: false, code: 'invalid_category' };
    return { ok: true, draft: {
      buildingId: membership.apartment.buildingId, apartmentId: membership.apartmentId, category: data.category,
      locationZone: 'apartment', affectedApartmentNumber: membership.apartment.number, description: data.description,
      ...(data.priority ? { priority: data.priority } : {}),
      photos: appPhotos(data.photos),
    } };
  }
  const allowed = zonesByCategory[data.category];
  const zone = allowed.length === 1 ? allowed[0] : data.locationZone;
  if (!zone) return { ok: false, code: 'zone_required' };
  if (!allowed.includes(zone)) return { ok: false, code: 'zone_not_for_category' };
  const needsEntrance = zone === 'entrance' || zone === 'elevator';
  if (needsEntrance && (!data.entranceNumber || data.entranceNumber > membership.apartment.building.entrancesCount)) return { ok: false, code: 'entrance_required' };
  return { ok: true, draft: {
    buildingId: membership.apartment.buildingId, apartmentId: membership.apartmentId, category: data.category,
    locationZone: zone, ...(needsEntrance ? { entranceNumber: data.entranceNumber } : {}), description: data.description,
    ...(data.priority ? { priority: data.priority } : {}),
    photos: appPhotos(data.photos),
  } };
}

// Before a new incident is created the resident sees whether neighbours have
// already reported the same thing and can join instead of duplicating it.
residentRouter.post('/incidents/similar', async (request, response, next) => {
  try {
    const { user } = miniApp(response);
    const result = await toDraft(user.id, { description: 'проверка совпадений', ...request.body });
    if (!result.ok) { response.status(400).json({ code: result.code }); return; }
    const matches = await findMatchingIncidents(user.id, result.draft);
    response.json({
      items: matches.map((incident) => ({
        id: incident.id, number: incident.number, title: incident.title, status: incident.status,
        reportsCount: incident._count.reports, createdAt: incident.createdAt, updatedAt: incident.updatedAt,
      })),
    });
  } catch (error) { next(error); }
});

residentRouter.post('/incidents', async (request, response, next) => {
  try {
    const { user } = miniApp(response);
    const result = await toDraft(user.id, request.body);
    if (!result.ok) { response.status(400).json({ code: result.code }); return; }
    const incident = await createIncidentFromReport(user.id, result.draft);
    response.status(201).json({ item: { id: incident.id, number: incident.number } });
  } catch (error) { next(error); }
});

residentRouter.post('/incidents/:id/join', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    try {
      const result = await joinPublicIncident(user.id, id.data, membership.apartment.buildingId, membership.apartmentId);
      response.json({ alreadyJoined: result.alreadyJoined });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') { response.status(404).json({ code: 'incident_not_found' }); return; }
      throw error;
    }
  } catch (error) { next(error); }
});

residentRouter.post('/incidents/:id/cancel', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const { user } = miniApp(response);
    const result = await cancelResidentReport(user.id, id.data);
    if (!result) { response.status(409).json({ code: 'cannot_cancel' }); return; }
    const removeComments = z.object({ deleteComments: z.boolean().optional() }).safeParse(request.body ?? {});
    const removed = removeComments.success && removeComments.data.deleteComments
      ? (await prisma.incidentComment.deleteMany({ where: { incidentId: id.data, authorUserId: user.id } })).count
      : 0;
    response.json({ ...result, commentsDeleted: removed });
  } catch (error) { next(error); }
});

// The resident confirms the result (and may rate it) or returns the incident.
residentRouter.post('/incidents/:id/feedback', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const parsed = feedbackSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_feedback' }); return; }
    const result = await giveFeedback(miniApp(response).user.id, id.data, parsed.data);
    if (!result.ok) { response.status(result.code === 'incident_not_found' ? 404 : 409).json({ code: result.code }); return; }
    response.json({ reopened: result.reopened });
  } catch (error) { next(error); }
});

const commentSchema = z.object({ text: z.string().trim().min(2).max(1000) });

// A resident removes their own comment; neighbours and the company stop seeing it.
residentRouter.delete('/incidents/:id/comments/:commentId', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.commentId).success || !z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'comment_not_found' }); return; }
    const removed = await prisma.incidentComment.deleteMany({ where: { id: request.params.commentId, incidentId: String(request.params.id), authorUserId: miniApp(response).user.id } });
    if (!removed.count) { response.status(404).json({ code: 'comment_not_found' }); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});

residentRouter.post('/incidents/:id/comments', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    const parsed = commentSchema.safeParse(request.body);
    if (!id.success || !parsed.success) { response.status(400).json({ code: 'invalid_comment' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    // Same rule as in the bot: the discussion belongs to common incidents of
    // the resident's own house.
    const incident = await prisma.incident.findFirst({
      where: { id: id.data, buildingId: membership.apartment.buildingId, locationZone: { not: 'apartment' }, archivedAt: null },
      select: { id: true },
    });
    if (!incident) { response.status(404).json({ code: 'incident_not_found' }); return; }
    const comment = await prisma.incidentComment.create({ data: { incidentId: incident.id, authorUserId: user.id, apartmentId: membership.apartmentId, text: parsed.data.text } });
    response.status(201).json({ item: { id: comment.id } });
  } catch (error) { next(error); }
});

// ---------- information ----------

// The announcements a resident of this apartment receives.
function announcementsFor(membership: NonNullable<Awaited<ReturnType<typeof membershipOf>>>): Prisma.AnnouncementWhereInput {
  const { companyId, street } = membership.apartment.building;
  return {
    archivedAt: null,
    OR: [
      { audience: 'all', companyId },
      { audience: 'street', street, companyId },
      { audience: 'building', buildingId: membership.apartment.buildingId },
      // Messages to the apartment sent before the resident moved in stay private.
      { audience: 'apartment', apartmentId: membership.apartmentId, createdAt: { gte: membership.verifiedAt } },
    ],
  };
}

residentRouter.get('/announcements', async (_request, response, next) => {
  try {
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.json({ items: [] }); return; }
    const items = await prisma.announcement.findMany({
      where: announcementsFor(membership),
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, audience: true, text: true, createdAt: true, reads: { where: { userId: user.id }, select: { readAt: true } } },
    });
    response.json({ items: items.map(({ reads, ...item }) => ({ ...item, read: reads.length > 0 })) });
  } catch (error) { next(error); }
});

residentRouter.post('/announcements/read', async (request, response, next) => {
  try {
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(204).end(); return; }
    const parsed = z.object({ ids: z.array(z.string().uuid()).max(100).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) { response.status(400).json({ code: 'invalid_announcements' }); return; }
    // One announcement, or all of them when no ids are given.
    const visible = await prisma.announcement.findMany({
      where: { AND: [announcementsFor(membership), ...(parsed.data.ids ? [{ id: { in: parsed.data.ids } }] : [])] },
      select: { id: true },
      take: 500,
    });
    await prisma.announcementRead.createMany({ data: visible.map((item) => ({ userId: user.id, announcementId: item.id })), skipDuplicates: true });
    response.status(204).end();
  } catch (error) { next(error); }
});

// Dots on the tabs: incident updates since the resident last looked at the
// incidents, and announcements not marked as read.
residentRouter.get('/unread', async (_request, response, next) => {
  try {
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.json({ incidents: 0, announcements: 0, emergencies: 0, polls: 0 }); return; }
    const seen = await prisma.user.findUnique({ where: { id: user.id }, select: { incidentsSeenAt: true } });
    const since = seen?.incidentsSeenAt ?? membership.verifiedAt;
    const [updates, neighbours, announcements, emergencies, polls] = await Promise.all([
      prisma.incidentEvent.count({
        where: {
          type: 'incident_updated',
          createdAt: { gt: since },
          incident: { subscriptions: { some: { userId: user.id, enabled: true } } },
        },
      }),
      // New common problems of the house reported by neighbours.
      prisma.incident.count({
        where: { buildingId: membership.apartment.buildingId, locationZone: { not: 'apartment' }, createdAt: { gt: since }, reports: { none: { authorUserId: user.id } } },
      }),
      prisma.announcement.count({ where: { AND: [announcementsFor(membership), { reads: { none: { userId: user.id } } }] } }),
      // Emergencies of the house not resolved yet: an exclamation mark on the tab.
      prisma.incident.count({
        where: {
          buildingId: membership.apartment.buildingId, priority: 'emergency', archivedAt: null, status: { in: [...activeStatuses] },
          OR: [{ locationZone: { not: 'apartment' } }, { reports: { some: { authorUserId: user.id } } }],
        },
      }),
      unvotedPolls(user.id),
    ]);
    response.json({ incidents: updates + neighbours, announcements, emergencies, polls });
  } catch (error) { next(error); }
});

residentRouter.post('/incidents/seen', async (_request, response, next) => {
  try {
    await prisma.user.update({ where: { id: miniApp(response).user.id }, data: { incidentsSeenAt: new Date() } });
    response.status(204).end();
  } catch (error) { next(error); }
});

residentRouter.get('/duties', async (_request, response, next) => {
  try {
    const membership = await membershipOf(miniApp(response).user.id);
    response.json(await dutiesFor(membership?.apartment.building.companyId ?? null));
  } catch (error) { next(error); }
});

residentRouter.get('/contacts', async (_request, response, next) => {
  try {
    const membership = await membershipOf(miniApp(response).user.id);
    const companyId = membership?.apartment.building.companyId;
    const services = await prisma.emergencyService.findMany({
      where: { OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, phone: true, description: true },
    });
    const company = membership?.apartment.building.company ?? null;
    response.json({ company, emergencyServices: services, quickDial: quickDialOf(company?.quickDial) });
  } catch (error) { next(error); }
});
