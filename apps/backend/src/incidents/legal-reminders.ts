import { prisma } from '../shared/prisma.js';
import { blocks, bold } from '../shared/html.js';
import { legalTermLine, legalTermOf } from './legal-terms.js';
import { buildingZone } from '../shared/time-zone.js';

// Reminders of the legal terms to the staff of the company, in MAX: once when
// the term runs out soon (a quarter of it is left, but not less than an hour)
// and once when it has passed. Each is sent once per incident.

const activeStatuses = ['new', 'acknowledged', 'in_progress'] as const;
const lookBackMs = 45 * 24 * 3_600_000;

const pageSize = 200;

export async function remindLegalTerms(now = new Date()) {
  // Every open incident is looked at, page by page in a stable order; the
  // staff of a company is asked for once per run, not once per incident.
  const staffOf = new Map<string, Array<{ maxUserId: string | null }>>();
  let sent = 0;
  let cursor: string | undefined;
  for (;;) {
    const incidents = await prisma.incident.findMany({
      where: {
        status: { in: [...activeStatuses] },
        archivedAt: null,
        legalLateNotifiedAt: null,
        createdAt: { gte: new Date(now.getTime() - lookBackMs) },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true, number: true, title: true, category: true, priority: true, locationZone: true, createdAt: true, legalSoonNotifiedAt: true,
        building: { select: { address: true, companyId: true, city: true, longitude: true } },
      },
      orderBy: { id: 'asc' },
      take: pageSize,
    });
    if (!incidents.length) break;
    cursor = incidents[incidents.length - 1]!.id;
    sent += await remindPage(incidents, staffOf, now);
    if (incidents.length < pageSize) break;
  }
  return sent;
}

type ReminderIncident = {
  id: string; number: number; title: string; category: string; priority: string; locationZone: string; createdAt: Date; legalSoonNotifiedAt: Date | null;
  building: { address: string; companyId: string; city: string | null; longitude: number | null };
};

async function remindPage(incidents: ReminderIncident[], staffOf: Map<string, Array<{ maxUserId: string | null }>>, now: Date) {
  let sent = 0;
  for (const incident of incidents) {
    const term = legalTermOf({ ...incident, timeZone: buildingZone(incident.building) });
    const total = term.dueAt.getTime() - incident.createdAt.getTime();
    const left = term.dueAt.getTime() - now.getTime();
    const late = left <= 0;
    const soon = !late && !incident.legalSoonNotifiedAt && left <= Math.max(3_600_000, total / 4);
    if (!late && !soon) continue;
    let staff = staffOf.get(incident.building.companyId);
    if (!staff) {
      staff = await prisma.admin.findMany({
        where: { companyId: incident.building.companyId, maxUserId: { not: null }, role: { in: ['dispatcher', 'supervisor'] } },
        select: { maxUserId: true },
      });
      staffOf.set(incident.building.companyId, staff);
    }
    const recipients = staff;
    const text = blocks(
      [bold(late ? `⛔ Срок по закону истёк: заявка № ${incident.number}` : `⏳ Срок по закону скоро истечёт: заявка № ${incident.number}`)],
      [incident.title, `Адрес: ${incident.building.address}`],
      [legalTermLine(term, now)],
    ).value;
    const buttons = [
      [{ text: 'Открыть в приложении', payload: `desk_${incident.number}`, openApp: true }],
      [{ text: 'Открыть в диспетчерской', payload: 'desk:web' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ];
    await prisma.$transaction(async (tx) => {
      // Marked first: two workers never send the same reminder twice.
      const marked = await tx.incident.updateMany({
        where: late ? { id: incident.id, legalLateNotifiedAt: null } : { id: incident.id, legalSoonNotifiedAt: null },
        data: late ? { legalLateNotifiedAt: now, legalSoonNotifiedAt: incident.legalSoonNotifiedAt ?? now } : { legalSoonNotifiedAt: now },
      });
      // Terms that ran out long ago (for example before the reminders
      // existed) are only marked: the staff is not flooded with old news.
      const stale = late && -left > 24 * 3_600_000;
      if (!marked.count || !recipients.length || stale) return;
      await tx.outboxMessage.createMany({
        data: recipients.map((admin) => ({ incidentId: incident.id, type: late ? 'company_legal_late' : 'company_legal_soon', payload: { userId: admin.maxUserId!, text, format: 'html', buttons } })),
      });
      sent += recipients.length;
    });
  }
  return sent;
}
