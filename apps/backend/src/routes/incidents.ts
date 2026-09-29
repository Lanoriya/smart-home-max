import { Router } from 'express';
import { z } from 'zod';
import type { IncidentStatus } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { requireAdmin } from '../auth/session.js';
import { writeAdminAudit } from '../auth/admin-audit.js';

export const incidentsRouter = Router();
incidentsRouter.use(requireAdmin);

const patchIncidentSchema = z.object({
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

incidentsRouter.get('/', async (request, response, next) => {
  try {
    const archive = request.query.archive === 'true';
    const sort = typeof request.query.sort === 'string' ? request.query.sort : 'importance_desc';
    const orderBy = {
      date_desc: [{ createdAt: 'desc' as const }],
      date_asc: [{ createdAt: 'asc' as const }],
      importance_desc: [{ reports: { _count: 'desc' as const } }, { createdAt: 'desc' as const }],
      importance_asc: [{ reports: { _count: 'asc' as const } }, { createdAt: 'desc' as const }],
    }[sort] ?? [{ reports: { _count: 'desc' as const } }, { createdAt: 'desc' as const }];
    const incidents = await prisma.incident.findMany({
      where: archive ? { archivedAt: { not: null } } : { archivedAt: null },
      orderBy,
      take: 100,
      include: {
        building: { select: { address: true } },
        _count: { select: { reports: true, subscriptions: true, comments: true } },
      },
    });
    response.json({
      items: incidents.map((incident) => ({
        id: incident.id,
        title: incident.title,
        category: incident.category,
        locationZone: incident.locationZone,
        entranceNumber: incident.entranceNumber,
        apartmentNumber: incident.apartmentNumber,
        status: incident.status,
        priority: incident.priority,
        address: incident.building.address,
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
      })),
    });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get('/:id', async (request, response, next) => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: request.params.id },
      include: {
        building: { select: { address: true } },
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
        comments: { orderBy: { createdAt: 'asc' }, select: { id: true, text: true, createdAt: true, apartment: { select: { number: true } }, author: { select: { displayName: true, maxUserId: true } } } },
        photos: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, token: true, url: true, createdAt: true, author: { select: { memberships: { where: { revokedAt: null }, take: 1, include: { apartment: { select: { number: true } } } } } } },
        },
      },
    });
    if (!incident) {
      response.status(404).json({ code: 'incident_not_found' });
      return;
    }
    response.json({ item: incident });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.delete('/:id/comments/:commentId', async (request, response, next) => {
  try {
    const admin = response.locals.admin as { id: string };
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.incidentComment.deleteMany({ where: { id: request.params.commentId, incidentId: request.params.id } });
      if (result.count) await writeAdminAudit(tx, admin.id, 'incident_comment_deleted', 'incident_comment', request.params.commentId, { incidentId: request.params.id });
      return result;
    });
    if (!deleted.count) { response.status(404).json({ code: 'comment_not_found' }); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});

incidentsRouter.patch('/:id', async (request, response, next) => {
  try {
    const parsed = patchIncidentSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'invalid_incident_patch', details: parsed.error.flatten() });
      return;
    }
    const current = await prisma.incident.findUnique({ where: { id: request.params.id } });
    if (!current) {
      response.status(404).json({ code: 'incident_not_found' });
      return;
    }
    if (parsed.data.status && !canTransition(current.status, parsed.data.status)) {
      response.status(409).json({
        code: 'invalid_status_transition',
        from: current.status,
        to: parsed.data.status,
      });
      return;
    }
    if (parsed.data.dueAt && new Date(parsed.data.dueAt).getTime() <= Date.now()) {
      response.status(400).json({ code: 'due_at_in_past' });
      return;
    }

    const isResolved = parsed.data.status === 'resolved';
    const isRejected = parsed.data.status === 'rejected';
    const isTerminal = isResolved || isRejected;
    const archiveUpdate = parsed.data.archived === false || (parsed.data.status && !isTerminal)
      ? null
      : parsed.data.archived === true || isTerminal
        ? new Date()
        : undefined;
    const admin = response.locals.admin as { id: string; username: string };
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.incident.updateMany({
        where: { id: current.id, version: parsed.data.version },
        data: {
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
          ...(isResolved ? { delayReason: null, rejectionReason: null } : {}),
          ...(!isResolved && parsed.data.delayReason !== undefined ? { delayReason: parsed.data.delayReason } : {}),
          ...(isRejected ? { rejectionReason: parsed.data.rejectionReason ?? null } : {}),
          ...(!isRejected && parsed.data.rejectionReason !== undefined ? { rejectionReason: parsed.data.rejectionReason } : {}),
          ...(archiveUpdate !== undefined ? { archivedAt: archiveUpdate } : {}),
          ...(parsed.data.status === 'resolved' ? { resolvedAt: new Date() } : {}),
          ...(parsed.data.status && parsed.data.status !== 'resolved' ? { resolvedAt: null } : {}),
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
        publicComment: isResolved ? null : parsed.data.publicComment ?? null,
      };
      await tx.incidentEvent.create({
        data: {
          incidentId: current.id,
          actorAdminId: admin.id,
          type: 'incident_updated',
          payload,
        },
      });

      const subscriptions = await tx.incidentSubscription.findMany({
        where: { incidentId: current.id, enabled: true },
        include: { user: { select: { maxUserId: true } } },
      });
      if (subscriptions.length > 0 && parsed.data.archived !== false) {
        const text = notificationText(
          updated.id,
          updated.status,
          updated.dueAt,
          updated.delayReason,
          isResolved ? undefined : parsed.data.publicComment,
          updated.rejectionReason,
        );
        await tx.outboxMessage.createMany({
          data: subscriptions.map(({ user }) => ({
            incidentId: current.id,
            type: 'incident_updated',
            payload: { userId: user.maxUserId, text },
          })),
        });
      }
      return updated;
    });

    if (!result) {
      response.status(409).json({ code: 'incident_version_conflict' });
      return;
    }
    response.json({ item: result });
  } catch (error) {
    next(error);
  }
});

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

export function notificationText(
  incidentId: string,
  status: IncidentStatus,
  dueAt: Date | null,
  delayReason: string | null,
  comment?: string,
  rejectionReason?: string | null,
) {
  const labels: Record<IncidentStatus, string> = {
    new: 'Новая',
    acknowledged: 'Принята',
    in_progress: 'В работе',
    resolved: 'Устранена',
    rejected: 'Отклонена',
  };
  const parts = [
    `Инцидент №${incidentId.slice(0, 8).toUpperCase()}.`,
    `Статус проблемы изменён: ${labels[status]}.`,
  ];
  if (dueAt && !['resolved', 'rejected'].includes(status)) parts.push(`Плановый срок: ${formatNotificationDate(dueAt)}.`);
  if (delayReason) parts.push(`Причина переноса: ${delayReason}.`);
  if (rejectionReason) parts.push(`Причина отклонения: ${rejectionReason}.`);
  if (comment) parts.push(comment);
  return parts.join('\n');
}

function formatNotificationDate(value: Date) {
  return value.toLocaleString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
