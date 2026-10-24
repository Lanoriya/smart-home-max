import { prisma } from '../shared/prisma.js';

// The numbers a company and the platform watch during a pilot. The main one is
// "duplicates avoided": every neighbour who joined an existing common incident
// instead of filing a new one is a request the dispatcher did not have to sort.

const dayMs = 24 * 60 * 60 * 1000;


export async function companyStats(companyId: string | null, days = 30) {
  const scope = companyId ? { building: { companyId } } : {};
  const since = new Date(Date.now() - days * dayMs);
  const active = { archivedAt: null, status: { in: ['new' as const, 'acknowledged' as const, 'in_progress' as const] } };
  const [recent, open, overdue, residents, buildings, buildingsOnMap, newOnes, resolvedInPeriod, reopenedCount] = await Promise.all([
    prisma.incident.findMany({
      where: { ...scope, createdAt: { gte: since } },
      select: { createdAt: true, acknowledgedAt: true, resolvedAt: true, dueAt: true, status: true, locationZone: true, category: true, source: true, _count: { select: { reports: true } } },
    }),
    prisma.incident.count({ where: { ...scope, ...active } }),
    prisma.incident.count({ where: { ...scope, ...active, dueAt: { lt: new Date() } } }),
    prisma.residentMembership.count({ where: { revokedAt: null, ...(companyId ? { apartment: { building: { companyId } } } : {}) } }),
    prisma.building.count({ where: companyId ? { companyId } : {} }),
    prisma.building.count({ where: { ...(companyId ? { companyId } : {}), latitude: { not: null } } }),
    prisma.incident.count({ where: { ...scope, archivedAt: null, status: 'new' } }),
    // Resolved in the period, with the residents' answers: the share the
    // residents confirmed is the proof the work was really done.
    prisma.incident.findMany({
      where: { ...scope, status: 'resolved', resolvedAt: { gte: since } },
      select: { resolvedAt: true, feedback: { select: { resolved: true, rating: true, updatedAt: true } } },
    }),
    prisma.incidentEvent.count({ where: { type: 'resident_reopened', createdAt: { gte: since }, ...(companyId ? { incident: { building: { companyId } } } : {}) } }),
  ]);

  const reports = recent.reduce((sum, incident) => sum + incident._count.reports, 0);
  const duplicatesAvoided = recent
    .filter((incident) => incident.locationZone !== 'apartment')
    .reduce((sum, incident) => sum + Math.max(0, incident._count.reports - 1), 0);
  // Imported or hand-edited history can have a reaction before creation; such
  // records say nothing about the company's speed and are skipped.
  // A phone call is accepted while it is registered: it says nothing about
  // the reaction to residents in MAX.
  const reactionMinutes = median(recent.filter((incident) => incident.source !== 'phone').flatMap((incident) => (incident.acknowledgedAt && incident.acknowledgedAt >= incident.createdAt ? [(incident.acknowledgedAt.getTime() - incident.createdAt.getTime()) / 60_000] : [])));
  const resolved = recent.filter((incident) => incident.status === 'resolved' && incident.resolvedAt);
  const resolveHours = median(resolved.map((incident) => (incident.resolvedAt!.getTime() - incident.createdAt.getTime()) / 3_600_000));
  const withDeadline = resolved.filter((incident) => incident.dueAt);
  const onTimeShare = withDeadline.length ? withDeadline.filter((incident) => incident.resolvedAt! <= incident.dueAt!).length / withDeadline.length : null;
  const categories = new Map<string, number>();
  for (const incident of recent) categories.set(incident.category, (categories.get(incident.category) ?? 0) + 1);

  // Answers given to the latest "resolved" of each incident.
  const answers = resolvedInPeriod.map((incident) => incident.feedback.filter((item) => item.updatedAt >= incident.resolvedAt!));
  const confirmedCount = answers.filter((items) => items.some((item) => item.resolved)).length;
  const ratings = answers.flatMap((items) => items.flatMap((item) => (item.resolved && item.rating ? [item.rating] : [])));

  return {
    periodDays: days,
    incidents: recent.length,
    reports,
    duplicatesAvoided,
    // Share of resident reports that did not become a separate incident.
    duplicateShare: reports ? duplicatesAvoided / reports : null,
    open,
    newOnes,
    overdue,
    reactionMinutesMedian: reactionMinutes,
    resolveHoursMedian: resolveHours,
    onTimeShare,
    residents,
    buildings,
    buildingsOnMap,
    resolvedCount: resolvedInPeriod.length,
    confirmedCount,
    confirmedShare: resolvedInPeriod.length ? confirmedCount / resolvedInPeriod.length : null,
    reopenedCount,
    ratingAverage: ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null,
    ratingsCount: ratings.length,
    phoneIncidents: recent.filter((incident) => incident.source === 'phone').length,
    topCategories: [...categories.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([category, count]) => ({ category, count })),
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(value * 10) / 10;
}
