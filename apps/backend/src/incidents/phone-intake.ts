import { z } from 'zod';
import type { IncidentCategory } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { blocks, bold } from '../shared/html.js';
import { normalizeRussianPhone } from '../shared/phone.js';
import { apartmentNumberWhere, normalizeApartmentNumber } from '../shared/apartment-number.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { buildingWhere, type AdminActor } from '../auth/scope.js';
import { categoryValues, titleFromDraft, zonesByCategory } from './incident-service.js';
import { incidentButtons } from './admin-incidents.js';

// Calls do not go away with a bot: a dispatcher registers the incident from
// the phone on the desk. It joins the same queue, and when the apartment of
// the caller is in the service, its residents follow the incident in MAX as
// if they had reported it themselves: statuses, answers, the final check.

const apartmentCategories: IncidentCategory[] = ['water', 'electricity', 'heating', 'leak', 'other'];

export const phoneIncidentSchema = z.object({
  buildingId: z.string().uuid(),
  category: z.enum(categoryValues as [IncidentCategory, ...IncidentCategory[]]),
  locationZone: z.enum(['apartment', 'entrance', 'elevator', 'yard', 'common']),
  entranceNumber: z.number().int().min(1).max(50).nullable().optional(),
  apartmentNumber: z.string().trim().max(20).nullable().optional(),
  description: z.string().trim().min(5).max(1000),
  priority: z.enum(['normal', 'high', 'emergency']).default('normal'),
  callerName: z.string().trim().max(120).nullable().optional(),
  callerPhone: z.string().trim().max(40).nullable().optional(),
});

export type PhoneIncidentResult =
  | { ok: true; item: { id: string; number: number }; notified: number; apartmentInService: boolean }
  | { ok: false; code: 'building_not_found' | 'apartment_required' | 'apartment_not_found' | 'zone_not_for_category' | 'entrance_required' | 'invalid_phone' };

export async function createPhoneIncident(admin: AdminActor, companyId: string | null, input: z.infer<typeof phoneIncidentSchema>): Promise<PhoneIncidentResult> {
  const building = await prisma.building.findFirst({ where: { id: input.buildingId, ...buildingWhere(companyId) }, select: { id: true, entrancesCount: true } });
  if (!building) return { ok: false, code: 'building_not_found' };

  const zone = input.locationZone;
  if (zone === 'apartment' ? !apartmentCategories.includes(input.category) : !zonesByCategory[input.category].includes(zone)) return { ok: false, code: 'zone_not_for_category' };
  const needsEntrance = zone === 'entrance' || zone === 'elevator';
  if (needsEntrance && (!input.entranceNumber || input.entranceNumber > building.entrancesCount)) return { ok: false, code: 'entrance_required' };

  // The apartment of the caller: required for a problem inside it, optional
  // for a common one (then it says who to keep informed).
  const typed = input.apartmentNumber ? normalizeApartmentNumber(input.apartmentNumber) : null;
  if (input.apartmentNumber && !typed) return { ok: false, code: 'apartment_not_found' };
  if (zone === 'apartment' && !typed) return { ok: false, code: 'apartment_required' };
  const apartment = typed
    ? await prisma.apartment.findFirst({ where: { buildingId: building.id, ...apartmentNumberWhere(typed) }, select: { id: true, number: true } })
    : null;
  if (typed && !apartment) return { ok: false, code: 'apartment_not_found' };

  const phone = input.callerPhone ? normalizeRussianPhone(input.callerPhone) : null;
  if (input.callerPhone && !phone) return { ok: false, code: 'invalid_phone' };

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const incident = await tx.incident.create({
      data: {
        buildingId: building.id,
        category: input.category,
        locationZone: zone,
        ...(needsEntrance ? { entranceNumber: input.entranceNumber! } : {}),
        ...(zone === 'apartment' ? { apartmentNumber: apartment!.number } : {}),
        title: titleFromDraft({ category: input.category, description: input.description }),
        priority: input.priority,
        // The dispatcher took the call: the incident is accepted already.
        status: 'acknowledged',
        acknowledgedAt: now,
        source: 'phone',
        callerName: input.callerName || null,
        callerPhone: phone,
        callNote: input.description,
      },
    });

    // Residents of the apartment who use MAX get it as their own report.
    const members = apartment
      ? await tx.residentMembership.findMany({ where: { apartmentId: apartment.id, revokedAt: null }, distinct: ['userId'], select: { userId: true, user: { select: { maxUserId: true } } } })
      : [];
    if (members.length) {
      await tx.report.createMany({ data: members.map(({ userId }) => ({ incidentId: incident.id, authorUserId: userId, apartmentId: apartment!.id, description: input.description })) });
      await tx.incidentSubscription.createMany({ data: members.map(({ userId }) => ({ incidentId: incident.id, userId })) });
      const text = blocks(
        [bold(`Заявка № ${incident.number} зарегистрирована по звонку`), incident.title],
        ['Диспетчер управляющей компании принял ваше обращение по телефону. Статус, сроки и ответы УК будут приходить сюда, в чат с ботом.'],
      ).value;
      await tx.outboxMessage.createMany({
        data: members.map(({ user }) => ({ incidentId: incident.id, type: 'incident_registered', payload: { userId: user.maxUserId, text, format: 'html', buttons: incidentButtons(incident.id, incident.number) } })),
      });
    }

    await tx.incidentEvent.create({
      data: { incidentId: incident.id, actorAdminId: admin.id, type: 'incident_registered_by_phone', payload: { description: input.description, apartmentNumber: apartment?.number ?? null, notified: members.length } },
    });
    await writeAdminAudit(tx, admin.id, 'incident_created_by_phone', 'incident', incident.id, { buildingId: building.id, notified: members.length });
    return { ok: true, item: { id: incident.id, number: incident.number }, notified: members.length, apartmentInService: members.length > 0 };
  });
}
