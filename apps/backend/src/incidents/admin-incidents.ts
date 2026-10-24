import { z } from 'zod';
import { legalTermOf } from './legal-terms.js';
import type { IncidentStatus, Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { viaBuilding, type AdminActor } from '../auth/scope.js';
import { type Html, blocks, bold, html } from '../shared/html.js';
import type { CallbackButton } from '../bot/messenger.js';
import { buildingZone, formatInZone } from '../shared/time-zone.js';
import { acceptanceOf, feedbackSummary } from './resident-feedback.js';

// Incident work of a company administrator. Shared by the web dispatcher desk
// and the mini-app so both follow the same rules and notify residents alike.
// Every query is limited to the buildings of the acting company: an incident
// of another company is reported as not found.

export const patchIncidentSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(['new', 'acknowledged', 'in_progress', 'resolved', 'rejected']).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  delayReason: z.string().trim().max(500).nullable().optional(),
  rejectionReason: z.string().trim().min(3).max(500).nullable().optional(),
  archived: z.boolean().optional(),
  publicComment: z.string().trim().min(3).max(1000).optional(),
}).refine(
  (data) => data.status !== undefined || data.delayReason !== undefined || data.rejectionReason !== undefined || data.archived !== undefined || data.publicComment !== undefined,
  { message: 'At least one change is required' },
).superRefine((data, context) => {
  if (data.status === 'rejected' && !data.rejectionReason) {
    context.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'Rejection reason is required' });
  }
});

export type IncidentPatch = z.infer<typeof patchIncidentSchema>;

export const listFiltersSchema = z.object({
  buildingId: z.string().uuid().optional(),
  street: z.string().trim().min(1).max(300).optional(),
  number: z.coerce.number().int().positive().optional(),
  category: z.enum(['water', 'electricity', 'heating', 'elevator', 'leak', 'cleaning', 'other']).optional(),
  zone: z.enum(['entrance', 'elevator', 'yard', 'common', 'apartment']).optional(),
  status: z.enum(['new', 'acknowledged', 'in_progress', 'resolved', 'rejected']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'emergency']).optional(),
  archive: z.enum(['true', 'false']).optional(),
  sort: z.string().optional(),
});

const orderings: Record<string, Prisma.IncidentOrderByWithRelationInput[]> = {
  // Emergencies first, then urgent ones; inside each the most reported.
  urgency_desc: [{ priority: 'desc' }, { reports: { _count: 'desc' } }, { createdAt: 'desc' }],
  date_desc: [{ createdAt: 'desc' }],
  date_asc: [{ createdAt: 'asc' }],
  importance_desc: [{ reports: { _count: 'desc' } }, { createdAt: 'desc' }],
  importance_asc: [{ reports: { _count: 'asc' } }, { createdAt: 'desc' }],
  // Incidents of one kind or one place end up next to each other.
  category: [{ category: 'asc' }, { reports: { _count: 'desc' } }, { createdAt: 'desc' }],
  zone: [{ locationZone: 'asc' }, { entranceNumber: 'asc' }, { createdAt: 'desc' }],
  address: [{ building: { street: 'asc' } }, { building: { house: 'asc' } }, { createdAt: 'desc' }],
  // Incidents without a deadline go last.
  due_asc: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
  updated_desc: [{ updatedAt: 'desc' }],
};

export async function listIncidents(companyId: string | null, filters: z.infer<typeof listFiltersSchema>) {
  const { buildingId, street, number, category, zone, status, priority } = filters;
  const archive = filters.archive === 'true';
  const incidents = await prisma.incident.findMany({
    // A number search ignores the queue/archive split and other filters: the
    // dispatcher is looking for one specific incident.
    where: {
      ...viaBuilding(companyId),
      ...(number ? { number } : {
        ...(archive ? { archivedAt: { not: null } } : { archivedAt: null }),
        ...(buildingId ? { buildingId } : street ? { building: { street, ...(companyId ? { companyId } : {}) } } : {}),
        ...(category ? { category } : {}),
        ...(zone ? { locationZone: zone } : {}),
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
      }),
    },
    orderBy: orderings[filters.sort ?? 'importance_desc'] ?? orderings.importance_desc!,
    take: 100,
    include: {
      building: { select: { address: true, companyId: true, latitude: true, longitude: true, city: true } },
      _count: { select: { reports: true, subscriptions: true, comments: true } },
    },
  });
  return incidents.map((incident) => {
    const timeZone = buildingZone(incident.building);
    return {
    id: incident.id,
    number: incident.number,
    title: incident.title,
    category: incident.category,
    locationZone: incident.locationZone,
    entranceNumber: incident.entranceNumber,
    apartmentNumber: incident.apartmentNumber,
    status: incident.status,
    priority: incident.priority,
    source: incident.source,
    buildingId: incident.buildingId,
    companyId: incident.building.companyId,
    address: incident.building.address,
    latitude: incident.building.latitude,
    longitude: incident.building.longitude,
    reportsCount: incident._count.reports,
    subscribersCount: incident._count.subscriptions,
    commentsCount: incident._count.comments,
    dueAt: incident.dueAt,
    delayReason: incident.delayReason,
    rejectionReason: incident.rejectionReason,
    archivedAt: incident.archivedAt,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    version: incident.version,
    timeZone,
    legalTerm: legalTermOf({ ...incident, timeZone }),
  };
  });
}

export async function getIncident(companyId: string | null, id: string) {
  const incident = await findIncident(companyId, id);
  if (!incident) return null;
  const timeZone = buildingZone(incident.building);
  // The latest answer of each resident who reported the incident.
  return { ...incident, timeZone, legalTerm: legalTermOf({ ...incident, timeZone }), feedbackSummary: feedbackSummary(incident.feedback), acceptance: acceptanceOf(incident, incident.feedback) };
}

function findIncident(companyId: string | null, id: string) {
  return prisma.incident.findFirst({
    where: { id, ...viaBuilding(companyId) },
    include: {
      building: { select: { address: true, city: true, longitude: true } },
      reports: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          description: true,
          createdAt: true,
          apartment: { select: { number: true } },
          author: { select: { displayName: true, maxUserId: true } },
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, type: true, payload: true, createdAt: true },
      },
      _count: { select: { subscriptions: true, comments: true } },
      feedback: { orderBy: { updatedAt: 'desc' }, select: { id: true, resolved: true, rating: true, comment: true, updatedAt: true, apartment: { select: { number: true } } } },
      comments: { orderBy: { createdAt: 'asc' }, select: { id: true, text: true, createdAt: true, apartment: { select: { number: true } }, author: { select: { displayName: true, maxUserId: true } } } },
      photos: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, token: true, url: true, createdAt: true, author: { select: { memberships: { where: { revokedAt: null }, take: 1, include: { apartment: { select: { number: true } } } } } } },
      },
    },
  });
}

export async function deleteIncidentComment(admin: AdminActor, companyId: string | null, incidentId: string, commentId: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.incidentComment.deleteMany({ where: { id: commentId, incidentId, incident: viaBuilding(companyId) } });
    if (result.count) await writeAdminAudit(tx, admin.id, 'incident_comment_deleted', 'incident_comment', commentId, { incidentId });
    return result.count > 0;
  });
}

export type UpdateResult =
  | { ok: true; item: Prisma.IncidentGetPayload<object> }
  | { ok: false; status: 400 | 404 | 409; code: string; from?: IncidentStatus; to?: IncidentStatus };

export async function updateIncident(admin: AdminActor, companyId: string | null, incidentId: string, patch: IncidentPatch): Promise<UpdateResult> {
  const current = await prisma.incident.findFirst({ where: { id: incidentId, ...viaBuilding(companyId) }, include: { building: { select: { city: true, longitude: true } } } });
  if (!current) return { ok: false, status: 404, code: 'incident_not_found' };
  if (patch.status && !canTransition(current.status, patch.status)) {
    return { ok: false, status: 409, code: 'invalid_status_transition', from: current.status, to: patch.status };
  }
  // An overdue deadline that is left unchanged must not block other edits,
  // for example closing the incident or adding a comment for residents.
  const dueAtChanged = patch.dueAt !== null && new Date(patch.dueAt).getTime() !== current.dueAt?.getTime();
  // Three years ahead at most: a typo in the year should not become a plan.
  if (patch.dueAt && dueAtChanged && new Date(patch.dueAt).getTime() > Date.now() + 3 * 366 * 24 * 60 * 60 * 1000) {
    return { ok: false, status: 400, code: 'due_at_too_far' };
  }
  if (patch.dueAt && dueAtChanged && new Date(patch.dueAt).getTime() <= Date.now()) {
    return { ok: false, status: 400, code: 'due_at_in_past' };
  }

  const isResolved = patch.status === 'resolved';
  const isRejected = patch.status === 'rejected';
  const isTerminal = isResolved || isRejected;
  const archiveUpdate = patch.archived === false || (patch.status && !isTerminal)
    ? null
    : patch.archived === true || isTerminal
      ? new Date()
      : undefined;
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.incident.updateMany({
      where: { id: current.id, version: patch.version },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        dueAt: patch.dueAt ? new Date(patch.dueAt) : null,
        ...(isResolved ? { delayReason: null, rejectionReason: null } : {}),
        ...(!isResolved && patch.delayReason !== undefined ? { delayReason: patch.delayReason } : {}),
        ...(isRejected ? { rejectionReason: patch.rejectionReason ?? null } : {}),
        ...(!isRejected && patch.rejectionReason !== undefined ? { rejectionReason: patch.rejectionReason } : {}),
        ...(archiveUpdate !== undefined ? { archivedAt: archiveUpdate } : {}),
        ...(patch.status === 'resolved' ? { resolvedAt: new Date() } : {}),
        ...(patch.status && patch.status !== 'resolved' ? { resolvedAt: null } : {}),
        // The first reaction of the company is remembered for the reaction
        // time metric; later edits do not move it.
        ...(patch.status && patch.status !== 'new' && !current.acknowledgedAt ? { acknowledgedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });
    if (changed.count === 0) return null;

    const updated = await tx.incident.findUniqueOrThrow({ where: { id: current.id } });
    const payload = {
      oldStatus: current.status,
      newStatus: updated.status,
      oldDueAt: current.dueAt?.toISOString() ?? null,
      newDueAt: updated.dueAt?.toISOString() ?? null,
      delayReason: updated.delayReason,
      rejectionReason: updated.rejectionReason,
      archivedAt: updated.archivedAt?.toISOString() ?? null,
      publicComment: isResolved ? null : patch.publicComment ?? null,
    };
    await tx.incidentEvent.create({
      data: { incidentId: current.id, actorAdminId: admin.id, type: 'incident_updated', payload },
    });

    const subscriptions = await tx.incidentSubscription.findMany({
      where: { incidentId: current.id, enabled: true },
      include: { user: { select: { maxUserId: true } } },
    });
    if (subscriptions.length > 0 && patch.archived !== false) {
      const askFeedback = updated.status === 'resolved' && current.status !== 'resolved';
      const text = notificationText({
        number: updated.number,
        title: updated.title,
        status: updated.status,
        previousStatus: current.status,
        dueAt: updated.dueAt,
        delayReason: updated.delayReason,
        comment: isResolved ? undefined : patch.publicComment,
        rejectionReason: updated.rejectionReason,
        timeZone: buildingZone(current.building),
        askFeedback,
      }).value;
      const buttons = askFeedback ? [...feedbackButtons(updated.id), ...incidentButtons(updated.id, updated.number)] : incidentButtons(updated.id, updated.number);
      await tx.outboxMessage.createMany({
        data: subscriptions.map(({ user }) => ({
          incidentId: current.id,
          type: 'incident_updated',
          payload: { userId: user.maxUserId, text, format: 'html', buttons },
        })),
      });
    }
    return updated;
  });

  if (!result) return { ok: false, status: 409, code: 'incident_version_conflict' };
  return { ok: true, item: result };
}

// The bot screen of the incident and, when the mini-app is configured, the
// same incident opened in the mini-app.
export function incidentButtons(incidentId: string, number: number): CallbackButton[][] {
  return [
    [{ text: 'Открыть заявку', payload: `incident:view:${incidentId}` }],
    [{ text: 'Открыть в приложении', payload: `incident_${number}`, openApp: true }],
    [{ text: 'В главное меню', payload: 'menu:main' }],
  ];
}

// "Is the problem gone?" — asked once the company marked the incident resolved.
export function feedbackButtons(incidentId: string): CallbackButton[][] {
  return [[
    { text: 'Да, решено', payload: `incident:accept:${incidentId}`, intent: 'positive' },
    { text: 'Не решено', payload: `incident:reopen:${incidentId}`, intent: 'negative' },
  ]];
}

const transitions: Record<IncidentStatus, IncidentStatus[]> = {
  new: ['acknowledged', 'in_progress', 'resolved', 'rejected'],
  acknowledged: ['new', 'in_progress', 'resolved', 'rejected'],
  in_progress: ['new', 'acknowledged', 'resolved', 'rejected'],
  resolved: ['new', 'acknowledged', 'in_progress', 'rejected'],
  rejected: ['new', 'acknowledged', 'in_progress', 'resolved'],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus) {
  return from === to || transitions[from].includes(to);
}

// Built with the html template: the dispatcher comment and reasons are
// escaped, the headings are bold.
export function notificationText(incident: {
  number: number;
  title: string;
  status: IncidentStatus;
  // The status before the change: shown as "Принята → В работе".
  previousStatus?: IncidentStatus | undefined;
  dueAt: Date | null;
  delayReason: string | null;
  comment?: string | undefined;
  rejectionReason?: string | null | undefined;
  // The zone of the house: the deadline is written on its clock.
  timeZone?: string | undefined;
  // "Resolved" for the first time: the resident is asked to confirm it.
  askFeedback?: boolean | undefined;
}): Html {
  const labels: Record<IncidentStatus, string> = {
    new: 'Новая',
    acknowledged: 'Принята',
    in_progress: 'В работе',
    resolved: 'Устранена',
    rejected: 'Отклонена',
  };
  const isClosed = ['resolved', 'rejected'].includes(incident.status);
  return blocks(
    [bold(`Заявка № ${incident.number}: обновление`), incident.title],
    [
      incident.previousStatus && incident.previousStatus !== incident.status
        ? html`Статус: ${labels[incident.previousStatus]} → ${bold(labels[incident.status])}`
        : html`Статус: ${bold(labels[incident.status])}`,
      incident.dueAt && !isClosed ? `Плановый срок: ${formatInZone(incident.dueAt, incident.timeZone ?? 'Europe/Moscow')}` : null,
      incident.delayReason ? `Причина переноса: ${incident.delayReason}` : null,
      incident.rejectionReason ? `Причина отклонения: ${incident.rejectionReason}` : null,
    ],
    incident.comment ? [bold('Сообщение УК'), incident.comment] : [],
    incident.askFeedback ? [bold('Проблема действительно решена?'), 'Если нет — нажмите «Не решено»: заявка сразу вернётся в работу, а УК получит уведомление. Если не ответить за 14 дней, работа будет считаться принятой.'] : [],
  );
}
