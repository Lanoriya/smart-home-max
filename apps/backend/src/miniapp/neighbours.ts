import { Router } from 'express';
import { apartmentNumberWhere, normalizeApartmentNumber } from '../shared/apartment-number.js';
import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { blocks, bold } from '../shared/html.js';
import { normalizeRussianPhone } from '../shared/phone.js';
import { miniApp } from './auth.js';
import { normalizePlate, plateWhere } from '../shared/plates.js';
import { lookupPhones, lookupVehicleInclude } from '../residents/vehicle-phones.js';
import { displayPhone } from '../shared/phone.js';

// The "Соседи" tab: who owns a car by its plate, a message to another
// apartment of the same house, and the resident's own cars. The rules are the bot's: a phone is shown only
// with the owner's consent, messages are limited per hour, and the recipients
// answer from the bot.

export const neighboursRouter = Router();

const messagesPerHour = 10;
const carsLimit = 5;

async function membershipOf(userId: string) {
  return prisma.residentMembership.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { verifiedAt: 'desc' },
    select: { apartmentId: true, apartment: { select: { number: true, buildingId: true } } },
  });
}

const carSchema = z.object({ plate: z.string().trim().min(4).max(20) });

neighboursRouter.post('/car-search', async (request, response, next) => {
  try {
    const parsed = carSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_plate' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const vehicles = await prisma.vehicle.findMany({
      where: plateWhere(parsed.data.plate),
      include: { ...lookupVehicleInclude, apartment: { include: { profile: true, building: { select: { address: true } }, memberships: { where: { revokedAt: null }, select: { userId: true } } } } },
      orderBy: { licensePlate: 'asc' },
      take: 10,
    });
    // A car is always found. Its phone is shown only when the apartment
    // allowed it; otherwise the owner can be written to through the service,
    // without anyone seeing the number.
    const items = vehicles.flatMap((vehicle) => {
      if (!vehicle.apartment) return [];
      const profile = vehicle.apartment.profile;
      const consent = Boolean(profile?.phoneConsentAt && profile.phoneVisibility === 'vehicle_lookup');
      const phones = lookupPhones(vehicle);
      return [{
        id: vehicle.id,
        plate: vehicle.licensePlate,
        mine: vehicle.apartmentId === membership.apartmentId,
        owner: consent ? vehicle.owner?.fullName ?? null : null,
        phones,
        address: consent ? `${vehicle.apartment.building.address}, кв. ${vehicle.apartment.number}` : null,
        canMessage: vehicle.apartment.memberships.some((member) => member.userId !== user.id),
      }];
    });
    response.json({ items });
  } catch (error) { next(error); }
});

const messageSchema = z.object({
  apartmentNumber: z.string().max(20).transform((value, context) => normalizeApartmentNumber(value) ?? (context.addIssue({ code: 'custom', message: 'Expected an apartment number' }), z.NEVER)),
  text: z.string().trim().min(2).max(1000),
});

// Messages a resident sends to neighbours are limited per hour. One message is
// one INSERT of rows with the same created_at, so distinct timestamps count
// messages (the same way as in the bot).
async function overMessageLimit(userId: string) {
  const sentRecently = await prisma.outboxMessage.findMany({
    where: { type: 'resident_message', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, payload: { path: ['senderUserId'], equals: userId } },
    distinct: ['createdAt'],
    select: { id: true },
    take: messagesPerHour,
  });
  return sentRecently.length >= messagesPerHour;
}

async function sendToApartment(senderId: string, sender: { apartmentId: string; apartment: { number: string } }, apartmentId: string, heading: string, message: string) {
  // Everyone connected there except the sender: the own apartment is fine too.
  const recipients = await prisma.residentMembership.findMany({ where: { apartmentId, revokedAt: null, userId: { not: senderId } }, distinct: ['userId'], select: { user: { select: { maxUserId: true } } } });
  if (!recipients.length) return 0;
  const buttons = [[{ text: 'Ответить квартире', payload: `resident:reply:${sender.apartmentId}`, intent: 'positive' }]];
  const text = blocks([bold(heading)], [message]).value;
  await prisma.outboxMessage.createMany({
    data: recipients.map(({ user: recipient }) => ({ type: 'resident_message', payload: { userId: recipient.maxUserId, senderUserId: senderId, text, format: 'html', buttons } })),
  });
  return recipients.length;
}

neighboursRouter.post('/message', async (request, response, next) => {
  try {
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_message' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const apartment = await prisma.apartment.findFirst({
      where: { buildingId: membership.apartment.buildingId, ...apartmentNumberWhere(parsed.data.apartmentNumber) },
      select: { id: true, number: true },
    });
    if (!apartment) { response.status(404).json({ code: 'apartment_not_found' }); return; }
    if (await overMessageLimit(user.id)) { response.status(429).json({ code: 'too_many_messages' }); return; }
    const own = apartment.id === membership.apartmentId;
    const sent = await sendToApartment(user.id, membership, apartment.id, own ? 'Сообщение от соседа по квартире' : `Сообщение от квартиры ${membership.apartment.number}`, parsed.data.text);
    if (!sent) { response.status(404).json({ code: own ? 'alone_in_apartment' : 'no_recipients' }); return; }
    response.status(202).json({ apartmentNumber: apartment.number });
  } catch (error) { next(error); }
});

// A message to the owner of a found car: delivered to the residents of its
// apartment, the sender does not learn who they are.
const carMessageSchema = z.object({ vehicleId: z.string().uuid(), text: z.string().trim().min(2).max(1000) });

neighboursRouter.post('/car-message', async (request, response, next) => {
  try {
    const parsed = carMessageSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_message' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const vehicle = await prisma.vehicle.findUnique({ where: { id: parsed.data.vehicleId }, select: { licensePlate: true, apartmentId: true } });
    if (!vehicle?.apartmentId) { response.status(404).json({ code: 'no_recipients' }); return; }
    if (await overMessageLimit(user.id)) { response.status(429).json({ code: 'too_many_messages' }); return; }
    const sent = await sendToApartment(user.id, membership, vehicle.apartmentId, `Про ваш автомобиль ${vehicle.licensePlate}`, parsed.data.text);
    if (!sent) { response.status(404).json({ code: 'no_recipients' }); return; }
    response.status(202).json({ plate: vehicle.licensePlate });
  } catch (error) { next(error); }
});

// ---------- the resident's own cars and the consent to show a phone ----------

neighboursRouter.get('/cars', async (_request, response, next) => {
  try {
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const [vehicles, profile, me] = await Promise.all([
      prisma.vehicle.findMany({ where: { apartmentId: membership.apartmentId }, include: { owner: true }, orderBy: { createdAt: 'asc' } }),
      prisma.residentProfile.findUnique({ where: { apartmentId: membership.apartmentId }, select: { phoneVisibility: true, phoneConsentAt: true } }),
      prisma.user.findUnique({ where: { id: user.id }, select: { sharedPhone: true } }),
    ]);
    response.json({
      items: vehicles.map((vehicle) => ({ id: vehicle.id, plate: vehicle.licensePlate, owner: vehicle.owner?.fullName ?? null, phones: (vehicle.owner?.phones ?? []).map(displayPhone) })),
      showPhone: Boolean(profile?.phoneConsentAt && profile.phoneVisibility === 'vehicle_lookup'),
      sharedPhone: me?.sharedPhone ? displayPhone(me.sharedPhone) : null,
      limit: carsLimit,
    });
  } catch (error) { next(error); }
});

const newCarSchema = z.object({
  plate: z.string().trim().min(4).max(20),
  owner: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(30).optional(),
});

neighboursRouter.post('/cars', async (request, response, next) => {
  try {
    const parsed = newCarSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_car' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const plate = normalizePlate(parsed.data.plate);
    if (plate.length < 5 || plate.length > 12) { response.status(400).json({ code: 'invalid_plate' }); return; }
    const phone = parsed.data.phone ? normalizeRussianPhone(parsed.data.phone) : null;
    if (parsed.data.phone && !phone) { response.status(400).json({ code: 'invalid_phone' }); return; }
    const existing = await prisma.vehicle.findUnique({ where: { licensePlate: plate }, select: { apartmentId: true } });
    if (existing) { response.status(409).json({ code: existing.apartmentId === membership.apartmentId ? 'car_already_yours' : 'car_taken' }); return; }
    if (await prisma.vehicle.count({ where: { apartmentId: membership.apartmentId } }) >= carsLimit) { response.status(409).json({ code: 'cars_limit' }); return; }
    // Without a name the resident is the owner, with the phone shared from MAX.
    const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { displayName: true, sharedPhone: true } });
    const ownerName = parsed.data.owner || me.displayName?.trim() || 'Житель квартиры';
    const phones = phone ? [phone] : !parsed.data.owner && me.sharedPhone ? [me.sharedPhone] : [];
    const car = await prisma.$transaction(async (tx) => {
      const profile = await tx.residentProfile.upsert({ where: { apartmentId: membership.apartmentId }, update: {}, create: { apartmentId: membership.apartmentId } });
      const owner = await tx.residentPerson.create({ data: { profileId: profile.id, fullName: ownerName, phones, isVehicleOwner: true } });
      return tx.vehicle.create({ data: { userId: user.id, apartmentId: membership.apartmentId, licensePlate: plate, ownerPersonId: owner.id } });
    });
    response.status(201).json({ id: car.id, plate: car.licensePlate });
  } catch (error) { next(error); }
});

neighboursRouter.delete('/cars/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'car_not_found' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const car = await prisma.vehicle.findFirst({ where: { id: request.params.id, apartmentId: membership.apartmentId }, select: { id: true, ownerPersonId: true } });
    if (!car) { response.status(404).json({ code: 'car_not_found' }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.vehicle.delete({ where: { id: car.id } });
      if (car.ownerPersonId) await tx.residentPerson.deleteMany({ where: { id: car.ownerPersonId, isVehicleOwner: true, vehicles: { none: {} } } });
    });
    response.status(204).end();
  } catch (error) { next(error); }
});

// The consent is given for the whole apartment, as in the bot.
neighboursRouter.put('/phone-visibility', async (request, response, next) => {
  try {
    const parsed = z.object({ show: z.boolean() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_visibility' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const data = parsed.data.show
      ? { phoneConsentAt: new Date(), phoneVisibility: 'vehicle_lookup' as const }
      : { phoneConsentAt: null, phoneVisibility: 'hidden' as const };
    await prisma.residentProfile.upsert({ where: { apartmentId: membership.apartmentId }, update: data, create: { apartmentId: membership.apartmentId, ...data } });
    response.json({ showPhone: parsed.data.show });
  } catch (error) { next(error); }
});

// The phone (and the name) of the owner of the resident's own car: without a
// phone neighbours can only write, not call.
const carOwnerSchema = z.object({ owner: z.string().trim().min(2).max(150).optional(), phone: z.string().trim().max(30).optional() });

neighboursRouter.patch('/cars/:id', async (request, response, next) => {
  try {
    const parsed = carOwnerSchema.safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_car' }); return; }
    const phone = parsed.data.phone ? normalizeRussianPhone(parsed.data.phone) : null;
    if (parsed.data.phone && !phone) { response.status(400).json({ code: 'invalid_phone' }); return; }
    const { user } = miniApp(response);
    const membership = await membershipOf(user.id);
    if (!membership) { response.status(409).json({ code: 'residence_required' }); return; }
    const car = await prisma.vehicle.findFirst({ where: { id: request.params.id, apartmentId: membership.apartmentId }, select: { id: true, ownerPersonId: true } });
    if (!car) { response.status(404).json({ code: 'car_not_found' }); return; }
    await prisma.$transaction(async (tx) => {
      const data = { ...(parsed.data.owner ? { fullName: parsed.data.owner } : {}), ...(parsed.data.phone !== undefined ? { phones: phone ? [phone] : [] } : {}) };
      if (car.ownerPersonId) {
        await tx.residentPerson.update({ where: { id: car.ownerPersonId }, data });
        return;
      }
      const profile = await tx.residentProfile.upsert({ where: { apartmentId: membership.apartmentId }, update: {}, create: { apartmentId: membership.apartmentId } });
      const owner = await tx.residentPerson.create({ data: { profileId: profile.id, fullName: parsed.data.owner ?? 'Житель квартиры', phones: phone ? [phone] : [], isVehicleOwner: true } });
      await tx.vehicle.update({ where: { id: car.id }, data: { ownerPersonId: owner.id } });
    });
    response.status(204).end();
  } catch (error) { next(error); }
});
