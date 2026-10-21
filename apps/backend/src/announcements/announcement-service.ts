import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { viaApartment, type AdminActor } from '../auth/scope.js';
import { blocks, bold } from '../shared/html.js';

// Announcements of a company to its residents, sent by the bot. Shared by the
// web dispatcher desk and the mini-app.

export const announcementSchema = z.object({
  audience: z.enum(['all', 'street', 'building', 'apartment']),
  street: z.string().trim().min(1).max(200).optional(),
  buildingId: z.string().uuid().optional(),
  apartmentId: z.string().uuid().optional(),
  text: z.string().trim().min(3).max(2000),
}).superRefine((value, context) => {
  if (value.audience === 'apartment' && !value.apartmentId) {
    context.addIssue({ code: 'custom', path: ['apartmentId'], message: 'Apartment is required' });
  }
  if (value.audience === 'street' && !value.street) {
    context.addIssue({ code: 'custom', path: ['street'], message: 'Street is required' });
  }
  if (value.audience === 'building' && !value.buildingId) {
    context.addIssue({ code: 'custom', path: ['buildingId'], message: 'Building is required' });
  }
});

const announcementHeadings = {
  all: 'Объявление УК для всех жителей',
  street: 'Объявление УК для вашей улицы',
  building: 'Объявление УК для вашего дома',
  apartment: 'Сообщение УК для вашей квартиры',
} as const;

export type AnnouncementInput = z.infer<typeof announcementSchema>;

export async function queueAnnouncement(admin: AdminActor, companyId: string, input: AnnouncementInput) {
  const { audience, apartmentId, buildingId, street } = input;
  const audienceFilter = audience === 'apartment' && apartmentId
    ? { apartmentId }
    : audience === 'building' && buildingId
      ? { apartment: { buildingId } }
      : audience === 'street' && street
        ? { apartment: { building: { street } } }
        : {};
  const memberships = await prisma.residentMembership.findMany({
    // "All residents" means all residents of this company, and a street or
    // building of another company simply has no recipients here.
    where: { revokedAt: null, AND: [audienceFilter, viaApartment(companyId)] },
    distinct: ['userId'],
    select: { user: { select: { maxUserId: true } } },
  });
  if (!memberships.length) return { ok: false as const, code: 'recipients_not_found' };
  const text = blocks([bold(announcementHeadings[audience])], [input.text]).value;
  const buttons = [[{ text: 'Все объявления УК', payload: 'announcements:list' }], [{ text: 'Открыть в приложении', payload: 'announcements', openApp: true }]];
  await prisma.$transaction(async (tx) => {
    // The announcement is kept so residents can reread it in the bot archive.
    const announcement = await tx.announcement.create({
      data: {
        audience,
        text: input.text,
        recipientsCount: memberships.length,
        companyId,
        adminId: admin.id,
        ...(audience === 'street' && street ? { street } : {}),
        ...(audience === 'building' && buildingId ? { buildingId } : {}),
        ...(audience === 'apartment' && apartmentId ? { apartmentId } : {}),
      },
    });
    await tx.outboxMessage.createMany({
      data: memberships.map(({ user }) => ({ type: 'admin_announcement', payload: { userId: user.maxUserId, text, format: 'html', buttons } })),
    });
    await writeAdminAudit(tx, admin.id, 'announcement_queued', 'announcement', announcement.id, {
      audience,
      street: street ?? null,
      buildingId: buildingId ?? null,
      apartmentId: apartmentId ?? null,
      recipientsCount: memberships.length,
    });
  });
  return { ok: true as const, recipientsCount: memberships.length };
}
