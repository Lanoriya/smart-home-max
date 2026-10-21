import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { blocks, bold } from '../shared/html.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { requireCompanyId } from '../auth/scope.js';
import { displayPhone } from '../shared/phone.js';
import { miniApp } from '../miniapp/auth.js';
import { companyZone, localTime } from '../shared/time-zone.js';

// Reception of citizens. The company opens windows of time; a resident takes
// a free one and names the topic of the visit. The company is told about a
// booking and a cancellation in MAX, the resident about a cancellation by
// the company. A resident holds at most two future visits.

const maxBookings = 2;
const when = (date: Date, zone: string) => localTime(date, zone);

function membershipOf(userId: string) {
  return prisma.residentMembership.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { verifiedAt: 'desc' },
    select: { apartmentId: true, apartment: { select: { number: true, building: { select: { address: true, companyId: true } } } } },
  });
}

async function staffOf(companyId: string) {
  const admins = await prisma.admin.findMany({ where: { companyId, maxUserId: { not: null }, role: { in: ['dispatcher', 'supervisor'] } }, select: { maxUserId: true } });
  return admins.map((admin) => admin.maxUserId!);
}

const deskButtons = [[{ text: 'Открыть в приложении', payload: 'desk_appointments', openApp: true }], [{ text: 'В главное меню', payload: 'menu:main' }]];

// ---------- residents ----------

export const residentAppointmentsRouter = Router();

residentAppointmentsRouter.get('/', async (_request, response, next) => {
  try {
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.json({ company: null, free: [], mine: [] }); return; }
    const companyId = membership.apartment.building.companyId;
    const now = new Date();
    const [company, free, mine] = await Promise.all([
      prisma.managementCompany.findUnique({ where: { id: companyId }, select: { name: true, address: true, receptionHours: true, phone: true } }),
      prisma.appointment.findMany({ where: { companyId, userId: null, startsAt: { gt: now, lt: new Date(now.getTime() + 45 * 24 * 3_600_000) } }, orderBy: { startsAt: 'asc' }, take: 300, select: { id: true, startsAt: true, durationMinutes: true } }),
      prisma.appointment.findMany({ where: { companyId, userId: user.id, startsAt: { gt: new Date(now.getTime() - 3_600_000) } }, orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, durationMinutes: true, topic: true } }),
    ]);
    response.json({ company, free, mine, limit: maxBookings, timeZone: await companyZone(companyId) });
  } catch (error) { next(error); }
});

residentAppointmentsRouter.post('/:id/book', async (request, response, next) => {
  try {
    const parsed = z.object({ topic: z.string().trim().min(3).max(300) }).safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_booking' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const companyId = membership.apartment.building.companyId;
    const now = new Date();
    const outcome = await prisma.$transaction(async (tx) => {
      // The bookings of one resident are counted and taken one request at a
      // time: two taps at once cannot pass the limit together.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointments:${user.id}`}))`;
      if (await tx.appointment.count({ where: { companyId, userId: user.id, startsAt: { gt: now } } }) >= maxBookings) return 'too_many_bookings' as const;
      // Taken atomically: two residents never get the same window.
      const taken = await tx.appointment.updateMany({
        where: { id: String(request.params.id), companyId, userId: null, startsAt: { gt: now } },
        data: { userId: user.id, apartmentId: membership.apartmentId, topic: parsed.data.topic, bookedAt: now },
      });
      return taken.count ? 'booked' as const : 'slot_taken' as const;
    });
    if (outcome !== 'booked') { response.status(409).json({ code: outcome }); return; }
    const slot = await prisma.appointment.findUniqueOrThrow({ where: { id: String(request.params.id) }, select: { startsAt: true } });
    const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true, sharedPhone: true } });
    const text = blocks(
      [bold('📅 Новая запись на приём')],
      [when(slot.startsAt, await companyZone(companyId)), `${membership.apartment.building.address}, кв. ${membership.apartment.number}`, [profile?.displayName, profile?.sharedPhone ? displayPhone(profile.sharedPhone) : null].filter(Boolean).join(', ') || null],
      [`Тема: ${parsed.data.topic}`],
    ).value;
    const staff = await staffOf(companyId);
    if (staff.length) await prisma.outboxMessage.createMany({ data: staff.map((userId) => ({ type: 'appointment_booked', payload: { userId, text, format: 'html', buttons: deskButtons } })) });
    response.json({ startsAt: slot.startsAt });
  } catch (error) { next(error); }
});

residentAppointmentsRouter.delete('/:id/booking', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'booking_not_found' }); return; }
    const { user } = miniApp(response);
    const slot = await prisma.appointment.findFirst({ where: { id: String(request.params.id), userId: user.id }, include: { apartment: { select: { number: true, building: { select: { address: true } } } } } });
    if (!slot) { response.status(404).json({ code: 'booking_not_found' }); return; }
    await prisma.appointment.update({ where: { id: slot.id }, data: { userId: null, apartmentId: null, topic: null, bookedAt: null } });
    const staff = await staffOf(slot.companyId);
    const text = blocks([bold('Запись на приём отменена жителем')], [when(slot.startsAt, await companyZone(slot.companyId)), slot.apartment ? `${slot.apartment.building.address}, кв. ${slot.apartment.number}` : null, 'Окно снова свободно.']).value;
    if (staff.length && slot.startsAt > new Date()) await prisma.outboxMessage.createMany({ data: staff.map((userId) => ({ type: 'appointment_cancelled', payload: { userId, text, format: 'html', buttons: deskButtons } })) });
    response.status(204).end();
  } catch (error) { next(error); }
});

// ---------- the company ----------

export const companyAppointmentsRouter = Router();
const companyOf = (response: Parameters<typeof miniApp>[0]) => requireCompanyId(miniApp(response).admin!, response.locals.companyId);

companyAppointmentsRouter.get('/', async (_request, response, next) => {
  try {
    const companyId = companyOf(response);
    const since = new Date(Date.now() - 12 * 3_600_000);
    const items = await prisma.appointment.findMany({
      where: { companyId, startsAt: { gt: since } },
      orderBy: { startsAt: 'asc' },
      take: 500,
      select: {
        id: true, startsAt: true, durationMinutes: true, topic: true, bookedAt: true,
        user: { select: { displayName: true, sharedPhone: true } },
        apartment: { select: { number: true, building: { select: { address: true } } } },
      },
    });
    response.json({
      timeZone: await companyZone(companyId),
      items: items.map((item) => ({
        id: item.id, startsAt: item.startsAt, durationMinutes: item.durationMinutes, topic: item.topic, bookedAt: item.bookedAt,
        booked: Boolean(item.bookedAt),
        resident: item.bookedAt ? { name: item.user?.displayName ?? null, phone: item.user?.sharedPhone ? displayPhone(item.user.sharedPhone) : null, address: item.apartment ? `${item.apartment.building.address}, кв. ${item.apartment.number}` : null } : null,
      })),
    });
  } catch (error) { next(error); }
});

// Windows are sent as their start times, counted on the device of the
// employee: the day, the hours and the step are chosen there.
companyAppointmentsRouter.post('/', async (request, response, next) => {
  try {
    const parsed = z.object({ starts: z.array(z.coerce.date()).min(1).max(100), durationMinutes: z.number().int().min(5).max(180) }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_slots' }); return; }
    const companyId = companyOf(response);
    const future = parsed.data.starts.filter((date) => date.getTime() > Date.now() && date.getTime() < Date.now() + 120 * 24 * 3_600_000);
    if (!future.length) { response.status(400).json({ code: 'slots_in_past' }); return; }
    const created = await prisma.appointment.createMany({ data: future.map((startsAt) => ({ companyId, startsAt, durationMinutes: parsed.data.durationMinutes })), skipDuplicates: true });
    await writeAdminAudit(prisma, miniApp(response).admin!.id, 'appointment_slots_created', 'management_company', companyId, { count: created.count });
    response.status(201).json({ created: created.count, skipped: future.length - created.count });
  } catch (error) { next(error); }
});

companyAppointmentsRouter.delete('/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'slot_not_found' }); return; }
    const companyId = companyOf(response);
    const slot = await prisma.appointment.findFirst({ where: { id: String(request.params.id), companyId }, include: { user: { select: { maxUserId: true } } } });
    if (!slot) { response.status(404).json({ code: 'slot_not_found' }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.appointment.delete({ where: { id: slot.id } });
      // A booked window: the resident hears that the visit is cancelled.
      if (slot.user && slot.startsAt > new Date()) {
        const company = await tx.managementCompany.findUnique({ where: { id: companyId }, select: { name: true, phone: true } });
        const text = blocks([bold('Управляющая компания отменила вашу запись на приём')], [when(slot.startsAt, await companyZone(companyId)), slot.topic ? `Тема: ${slot.topic}` : null], [`Выберите другое время в приложении или позвоните: ${company?.phone ?? ''}`]).value;
        await tx.outboxMessage.create({ data: { type: 'appointment_cancelled_by_company', payload: { userId: slot.user.maxUserId, text, format: 'html', buttons: [[{ text: 'Записаться снова', payload: 'appointments', openApp: true }], [{ text: 'В главное меню', payload: 'menu:main' }]] } } });
      }
      await writeAdminAudit(tx, miniApp(response).admin!.id, 'appointment_slot_deleted', 'appointment', slot.id, { booked: Boolean(slot.userId) });
    });
    response.status(204).end();
  } catch (error) { next(error); }
});
