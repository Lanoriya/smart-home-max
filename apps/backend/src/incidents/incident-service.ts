import type { IncidentCategory, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../shared/prisma.js';

export const categoryLabels: Record<IncidentCategory, string> = {
  water: 'Водоснабжение',
  electricity: 'Электричество',
  heating: 'Отопление',
  elevator: 'Лифт',
  leak: 'Протечка',
  cleaning: 'Уборка',
  other: 'Другое',
};

export const categoryValues = Object.keys(categoryLabels) as IncidentCategory[];

type IncidentDraft = {
  buildingId: string;
  apartmentId: string;
  category: IncidentCategory;
  locationZone: string;
  entranceNumber?: number | undefined;
  affectedApartmentNumber?: string | undefined;
  description: string;
  photos?: Array<{ token: string; url?: string | undefined }> | undefined;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function findMatchingIncidents(userId: string, draft: IncidentDraft, db: DbClient = prisma) {
  // Apartment incidents contain private information. They are intentionally not
  // offered to neighbours as matches and can never be joined as a public issue.
  if (draft.locationZone === 'apartment') return [];
  const activeSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return db.incident.findMany({
    where: {
      buildingId: draft.buildingId,
      category: draft.category,
      locationZone: draft.locationZone,
      entranceNumber: draft.entranceNumber ?? null,
      apartmentNumber: draft.affectedApartmentNumber ?? null,
      status: { in: ['new', 'acknowledged', 'in_progress'] },
      updatedAt: { gte: activeSince },
      reports: { none: { authorUserId: userId } },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 3,
    include: { _count: { select: { reports: true } }, photos: { select: { token: true, url: true }, take: 9, orderBy: { createdAt: 'asc' } } },
  });
}

export async function createIncidentFromReport(userId: string, draft: IncidentDraft) {
  return prisma.$transaction(async (tx) => {
    const incident = await tx.incident.create({
      data: {
        buildingId: draft.buildingId,
        category: draft.category,
        locationZone: draft.locationZone,
        ...(draft.entranceNumber === undefined ? {} : { entranceNumber: draft.entranceNumber }),
        ...(draft.affectedApartmentNumber === undefined ? {} : { apartmentNumber: draft.affectedApartmentNumber }),
        title: titleFromDraft(draft),
      },
    });

    await tx.report.create({
      data: {
        incidentId: incident.id,
        authorUserId: userId,
        apartmentId: draft.apartmentId,
        description: draft.description,
      },
    });
    await tx.incidentSubscription.create({
      data: { incidentId: incident.id, userId },
    });
    await createPhotos(tx, incident.id, userId, draft.photos ?? []);
    await tx.incidentEvent.create({
      data: {
        incidentId: incident.id,
        actorUserId: userId,
        type: 'incident_created',
        payload: { description: draft.description },
      },
    });
    return incident;
  });
}

export async function addIncidentPhotos(userId: string, incidentId: string, photos: Array<{ token: string; url?: string }>) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.report.findUnique({ where: { incidentId_authorUserId: { incidentId, authorUserId: userId } } });
    if (!membership) throw new Error('Resident is not subscribed to this incident');
    const incident = await tx.incident.findUniqueOrThrow({ where: { id: incidentId } });
    if (['resolved', 'rejected'].includes(incident.status)) throw new Error('Incident is closed');
    await createPhotos(tx, incidentId, userId, photos);
  });
}

async function createPhotos(tx: Prisma.TransactionClient, incidentId: string, userId: string, photos: Array<{ token: string; url?: string | undefined }>) {
  const requested = photos.filter((photo) => photo.token || photo.url).slice(0, 3);
  if (!requested.length) return;
  const [total, own] = await Promise.all([
    tx.incidentPhoto.count({ where: { incidentId } }),
    tx.incidentPhoto.count({ where: { incidentId, authorUserId: userId } }),
  ]);
  const allowed = Math.min(3 - own, 9 - total, requested.length);
  if (allowed <= 0) throw new Error('Photo limit reached');
  await tx.incidentPhoto.createMany({
    data: requested.slice(0, allowed).map((photo) => ({ incidentId, authorUserId: userId, token: photo.token, ...(photo.url ? { url: photo.url } : {}) })),
  });
}

export async function joinIncident(userId: string, incidentId: string, draft: IncidentDraft) {
  if (draft.locationZone === 'apartment') {
    throw new Error('Apartment incidents cannot be joined');
  }
  return prisma.$transaction(async (tx) => {
    const incident = await tx.incident.findFirstOrThrow({
      where: {
        id: incidentId,
        buildingId: draft.buildingId,
        category: draft.category,
        locationZone: draft.locationZone,
        entranceNumber: draft.entranceNumber ?? null,
        apartmentNumber: draft.affectedApartmentNumber ?? null,
        status: { in: ['new', 'acknowledged', 'in_progress'] },
      },
    });

    const existingReport = await tx.report.findUnique({
      where: { incidentId_authorUserId: { incidentId, authorUserId: userId } },
    });
    if (existingReport) return { incident, alreadyJoined: true as const };

    await tx.report.create({
      data: {
        incidentId,
        authorUserId: userId,
        apartmentId: draft.apartmentId,
        description: draft.description,
      },
    });
    await tx.incidentSubscription.upsert({
      where: { incidentId_userId: { incidentId, userId } },
      update: { enabled: true },
      create: { incidentId, userId },
    });
    await createPhotos(tx, incidentId, userId, draft.photos ?? []);
    await tx.incidentEvent.create({
      data: {
        incidentId,
        actorUserId: userId,
        type: 'resident_joined',
        payload: { description: draft.description },
      },
    });
    return { incident, alreadyJoined: false as const };
  });
}

export async function joinPublicIncident(userId: string, incidentId: string, buildingId: string, apartmentId: string) {
  return prisma.$transaction(async (tx) => {
    const incident = await tx.incident.findFirstOrThrow({
      where: {
        id: incidentId,
        buildingId,
        locationZone: { not: 'apartment' },
        status: { in: ['new', 'acknowledged', 'in_progress'] },
        archivedAt: null,
      },
    });
    const existingReport = await tx.report.findUnique({ where: { incidentId_authorUserId: { incidentId, authorUserId: userId } } });
    if (existingReport) return { incident, alreadyJoined: true as const };
    await tx.report.create({ data: { incidentId, authorUserId: userId, apartmentId, description: 'Поддерживаю заявку.' } });
    await tx.incidentSubscription.upsert({
      where: { incidentId_userId: { incidentId, userId } }, update: { enabled: true }, create: { incidentId, userId },
    });
    await tx.incidentEvent.create({
      data: { incidentId, actorUserId: userId, type: 'resident_joined', payload: { description: 'Поддерживаю заявку.' } },
    });
    return { incident, alreadyJoined: false as const };
  });
}

export async function cancelResidentReport(userId: string, incidentId: string) {
  return prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({
      where: { incidentId_authorUserId: { incidentId, authorUserId: userId } },
      include: { incident: true },
    });
    if (!report || ['resolved', 'rejected'].includes(report.incident.status)) return null;
    await tx.report.delete({ where: { id: report.id } });
    await tx.incidentSubscription.deleteMany({ where: { incidentId, userId } });
    const reportsLeft = await tx.report.count({ where: { incidentId } });
    if (reportsLeft === 0) {
      await tx.incident.update({
        where: { id: incidentId },
        data: { status: 'rejected', rejectionReason: 'Обращение отменено жителем', archivedAt: new Date(), version: { increment: 1 } },
      });
    }
    await tx.incidentEvent.create({
      data: { incidentId, actorUserId: userId, type: 'resident_report_cancelled', payload: { reportsLeft } },
    });
    return { reportsLeft };
  });
}

export function titleFromDraft(draft: Pick<IncidentDraft, 'category' | 'description'>): string {
  const trimmed = draft.description.trim();
  return trimmed.length <= 70 ? trimmed : `${trimmed.slice(0, 67)}...`;
}
