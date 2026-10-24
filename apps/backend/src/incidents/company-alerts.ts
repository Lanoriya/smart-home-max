import type { IncidentPriority, Prisma } from '@prisma/client';
import { blocks, bold } from '../shared/html.js';
import { categoryLabels } from './incident-service.js';

// Company administrators who use the mini-app hear about their work in MAX:
// a new incident, and a common incident that more and more neighbours join.
// The more neighbours confirm a problem, the higher it climbs in the queue —
// the company sees what hurts the house most without reading every report.

type Tx = Prisma.TransactionClient;

// Number of residents on one common incident at which it is escalated.
export const escalationSteps: Array<{ reports: number; priority: IncidentPriority }> = [
  { reports: 3, priority: 'high' },
  { reports: 5, priority: 'high' },
  { reports: 10, priority: 'emergency' },
];

const priorityRank: Record<IncidentPriority, number> = { low: 0, normal: 1, high: 2, emergency: 3 };

export function escalationFor(reports: number) {
  return escalationSteps.find((step) => step.reports === reports) ?? null;
}

async function companyAdminsOf(tx: Tx, incidentId: string) {
  const incident = await tx.incident.findUniqueOrThrow({
    where: { id: incidentId },
    select: { id: true, number: true, title: true, category: true, locationZone: true, entranceNumber: true, apartmentNumber: true, priority: true, building: { select: { address: true, companyId: true } } },
  });
  const admins = await tx.admin.findMany({
    where: { companyId: incident.building.companyId, maxUserId: { not: null }, role: { in: ['dispatcher', 'supervisor'] } },
    select: { maxUserId: true },
  });
  return { incident, recipients: admins.map((admin) => admin.maxUserId!) };
}

function deskButtons(number: number) {
  return [
    [{ text: 'Открыть в приложении', payload: `desk_${number}`, openApp: true }],
    [{ text: 'Открыть в диспетчерской', payload: 'desk:web' }],
    [{ text: 'В главное меню', payload: 'menu:main' }],
  ];
}

export async function alertNewIncident(tx: Tx, incidentId: string) {
  const { incident, recipients } = await companyAdminsOf(tx, incidentId);
  if (!recipients.length) return;
  const place = incident.locationZone === 'apartment' ? `квартира ${incident.apartmentNumber ?? ''}`.trim() : incident.entranceNumber ? `подъезд ${incident.entranceNumber}` : null;
  // One sign, the colour of the urgency, so an emergency stands out in the chat.
  const urgency = incident.priority === 'emergency'
    ? '🔴 Авария: нужно немедленное вмешательство'
    : incident.priority === 'high' ? '🟠 Срочная заявка' : '🟢 Обычная заявка';
  const text = blocks(
    [bold(urgency)],
    [
      bold(`Новая заявка № ${incident.number}`),
      `Адрес: ${[incident.building.address, place].filter(Boolean).join(', ')}`,
      `Категория: ${categoryLabels[incident.category]}`,
      `Проблема: ${incident.title}`,
    ],
  ).value;
  await tx.outboxMessage.createMany({
    data: recipients.map((userId) => ({ incidentId, type: 'company_new_incident', payload: { userId, text, format: 'html', buttons: deskButtons(incident.number) } })),
  });
}

// A resident said the problem of a resolved incident is still there: the
// incident is back in work and the company hears it at once.
export async function alertReopenedIncident(tx: Tx, incidentId: string, apartmentNumber: string | null, comment: string | null) {
  const { incident, recipients } = await companyAdminsOf(tx, incidentId);
  if (!recipients.length) return;
  const text = blocks(
    [bold(`↩️ Заявка № ${incident.number} снова в работе`), incident.building.address],
    [incident.title],
    [`${apartmentNumber ? `Житель квартиры ${apartmentNumber}` : 'Житель'} сообщил, что проблема не устранена.`],
    comment ? [bold('Что не так'), comment] : [],
  ).value;
  await tx.outboxMessage.createMany({
    data: recipients.map((userId) => ({ incidentId, type: 'company_reopened', payload: { userId, text, format: 'html', buttons: deskButtons(incident.number) } })),
  });
}

// Called after a resident joined a common incident. Raises the priority when
// the number of residents reaches a step and tells the company once per step.
export async function escalateIfNeeded(tx: Tx, incidentId: string) {
  const reports = await tx.report.count({ where: { incidentId } });
  const step = escalationFor(reports);
  if (!step) return null;
  const { incident, recipients } = await companyAdminsOf(tx, incidentId);
  const raised = priorityRank[step.priority] > priorityRank[incident.priority];
  if (raised) {
    await tx.incident.update({ where: { id: incidentId }, data: { priority: step.priority, version: { increment: 1 } } });
  }
  await tx.incidentEvent.create({
    data: { incidentId, type: 'incident_escalated', payload: { reports, priority: raised ? step.priority : incident.priority } },
  });
  if (recipients.length) {
    const text = blocks(
      [bold(`Заявка № ${incident.number}: уже ${reports} ${residentsWord(reports)}`), incident.building.address],
      [incident.title],
      [raised ? `Приоритет повышен: ${step.priority === 'emergency' ? '🔴 авария' : '🟠 срочно'}.` : 'Соседи продолжают подтверждать проблему.'],
    ).value;
    await tx.outboxMessage.createMany({
      data: recipients.map((userId) => ({ incidentId, type: 'company_escalation', payload: { userId, text, format: 'html', buttons: deskButtons(incident.number) } })),
    });
  }
  return { reports, priority: raised ? step.priority : incident.priority };
}

export function residentsWord(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return 'жителей';
  if (ones === 1) return 'житель';
  if (ones >= 2 && ones <= 4) return 'жителя';
  return 'жителей';
}
