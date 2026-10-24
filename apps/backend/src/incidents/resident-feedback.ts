import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { blocks, bold } from '../shared/html.js';
import { alertReopenedIncident } from './company-alerts.js';
import { incidentButtons } from './admin-incidents.js';

// The resident closes the loop of an incident. When the company marks it
// resolved, everyone who reported it is asked: is the problem really gone?
// "Yes" may come with a rating of the work; "no" returns the incident to work
// at once and tells the company. The share of confirmed results is a figure
// of the pilot: it shows the work was done, not only marked done.

// How long after "resolved" the resident can still answer.
export const feedbackWindowDays = 14;
const windowMs = feedbackWindowDays * 24 * 60 * 60 * 1000;

export const feedbackSchema = z.discriminatedUnion('resolved', [
  z.object({ resolved: z.literal(true), rating: z.number().int().min(1).max(5).optional() }),
  z.object({ resolved: z.literal(false), comment: z.string().trim().max(500).optional() }),
]);

export type FeedbackState = {
  // The resident reported the incident and it waits for their answer or
  // still accepts a changed rating.
  canAnswer: boolean;
  answer: { resolved: boolean; rating: number | null; comment: string | null; at: Date } | null;
  until: Date | null;
};

type FeedbackIncident = { id: string; status: string; resolvedAt: Date | null };

export function feedbackOpen(incident: FeedbackIncident, now = Date.now()) {
  return incident.status === 'resolved' && Boolean(incident.resolvedAt) && now - incident.resolvedAt!.getTime() <= windowMs;
}

export async function feedbackState(userId: string, incident: FeedbackIncident, isReporter: boolean): Promise<FeedbackState> {
  const answer = await prisma.incidentFeedback.findUnique({ where: { incidentId_userId: { incidentId: incident.id, userId } } });
  // An answer given before the latest "resolved" belongs to the previous
  // round: the resident is asked again.
  const current = answer && incident.resolvedAt && answer.updatedAt >= incident.resolvedAt ? answer : null;
  const open = isReporter && feedbackOpen(incident);
  return {
    canAnswer: open,
    answer: current ? { resolved: current.resolved, rating: current.rating, comment: current.comment, at: current.updatedAt } : null,
    until: open ? new Date(incident.resolvedAt!.getTime() + windowMs) : null,
  };
}

export type FeedbackResult =
  | { ok: true; reopened: boolean; number: number }
  | { ok: false; code: 'incident_not_found' | 'feedback_closed' };

export async function giveFeedback(userId: string, incidentId: string, input: z.infer<typeof feedbackSchema>): Promise<FeedbackResult> {
  return prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({
      where: { incidentId_authorUserId: { incidentId, authorUserId: userId } },
      include: { incident: { select: { id: true, number: true, title: true, status: true, resolvedAt: true } } },
    });
    if (!report) return { ok: false, code: 'incident_not_found' };
    const { incident } = report;
    if (!feedbackOpen(incident)) return { ok: false, code: 'feedback_closed' };

    if (input.resolved) {
      await tx.incidentFeedback.upsert({
        where: { incidentId_userId: { incidentId, userId } },
        update: { resolved: true, rating: input.rating ?? null, comment: null, apartmentId: report.apartmentId },
        create: { incidentId, userId, apartmentId: report.apartmentId, resolved: true, rating: input.rating ?? null },
      });
      await tx.incidentEvent.create({ data: { incidentId, actorUserId: userId, type: 'resident_confirmed', payload: { rating: input.rating ?? null } } });
      return { ok: true, reopened: false, number: incident.number };
    }

    // Conditional on the status: two residents pressing "not solved" at once
    // reopen the incident once.
    const reopened = await tx.incident.updateMany({
      where: { id: incidentId, status: 'resolved' },
      data: { status: 'in_progress', archivedAt: null, resolvedAt: null, version: { increment: 1 } },
    });
    if (!reopened.count) return { ok: false, code: 'feedback_closed' };
    const comment = input.comment?.length ? input.comment : null;
    await tx.incidentFeedback.upsert({
      where: { incidentId_userId: { incidentId, userId } },
      update: { resolved: false, rating: null, comment, apartmentId: report.apartmentId },
      create: { incidentId, userId, apartmentId: report.apartmentId, resolved: false, comment },
    });
    await tx.incidentEvent.create({
      data: { incidentId, actorUserId: userId, type: 'resident_reopened', payload: { oldStatus: 'resolved', newStatus: 'in_progress', comment } },
    });
    const apartment = report.apartmentId ? await tx.apartment.findUnique({ where: { id: report.apartmentId }, select: { number: true } }) : null;
    await alertReopenedIncident(tx, incidentId, apartment?.number ?? null, comment);

    // The other residents of the incident hear that it is back in work.
    const others = await tx.incidentSubscription.findMany({
      where: { incidentId, enabled: true, userId: { not: userId } },
      select: { user: { select: { maxUserId: true } } },
    });
    if (others.length) {
      const text = blocks(
        [bold(`Заявка № ${incident.number}: снова в работе`), incident.title],
        ['Житель сообщил, что проблема не устранена. Заявка вернулась в работу, управляющая компания получила уведомление.'],
      ).value;
      await tx.outboxMessage.createMany({
        data: others.map(({ user }) => ({ incidentId, type: 'incident_reopened', payload: { userId: user.maxUserId, text, format: 'html', buttons: incidentButtons(incidentId, incident.number) } })),
      });
    }
    return { ok: true, reopened: true, number: incident.number };
  });
}

// Silence is consent: when nobody answered within the window, the work of a
// resolved incident counts as accepted. Nothing is written for that — the
// state follows from the date of "resolved" and the answers, so it is the
// same on the desk, in the figures and after a restart.
export type Acceptance = { state: 'confirmed' | 'silent' | 'waiting'; until: Date };

export function acceptanceOf(incident: { status: string; resolvedAt: Date | null }, answers: Array<{ resolved: boolean; updatedAt: Date }>, now = Date.now()): Acceptance | null {
  if (incident.status !== 'resolved' || !incident.resolvedAt) return null;
  const resolvedAt = incident.resolvedAt;
  const until = new Date(resolvedAt.getTime() + windowMs);
  // Only answers to the latest "resolved" count.
  if (answers.some((answer) => answer.resolved && answer.updatedAt >= resolvedAt)) return { state: 'confirmed', until };
  return { state: now > until.getTime() ? 'silent' : 'waiting', until };
}

// For the cards of the desk: who confirmed, who returned, and the ratings.
export function feedbackSummary(items: Array<{ resolved: boolean; rating: number | null }>) {
  const ratings = items.flatMap((item) => (item.resolved && item.rating ? [item.rating] : []));
  return {
    confirmed: items.filter((item) => item.resolved).length,
    returned: items.filter((item) => !item.resolved).length,
    ratingAverage: ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null,
  };
}
