import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import { prisma } from '../shared/prisma.js';
import { hashInviteCode } from '../users/invite-code.js';
import { env } from '../config/env.js';
import { writeAdminAudit } from '../auth/admin-audit.js';

export const apartmentsRouter = Router();
apartmentsRouter.use(requireAdmin);

const searchSchema = z.object({
  buildingId: z.string().uuid().optional(),
  query: z.string().trim().max(100).optional(),
  sort: z.enum(['apartment', 'resident']).optional(),
  withResidents: z.enum(['true', 'false']).optional(),
});
const updateSchema = z.object({
  number: z.string().trim().min(1).max(20),
  residentsCount: z.number().int().min(0).max(100).nullable(),
  people: z.array(z.object({ fullName: z.string().trim().min(2).max(150), phones: z.array(z.string().trim().min(3).max(50)).max(5) })).max(30),
  vehicles: z.array(z.object({ licensePlate: z.string().trim().min(3).max(20), ownerName: z.string().trim().min(1).max(150), ownerPhones: z.array(z.string().trim().min(3).max(50)).max(5) })).max(20),
  // An individual apartment code is an optional second factor. Its plaintext is
  // never returned by the API and is stored only as an HMAC hash.
  inviteCode: z.string().trim().min(6).max(64).nullable().optional(),
});

const apartmentInclude = {
  building: { select: { address: true } },
  profile: { select: { residentsCount: true, phones: true, people: { where: { isVehicleOwner: false }, select: { fullName: true, phones: true }, orderBy: { fullName: 'asc' } } } },
  vehicles: { select: { licensePlate: true, userId: true, owner: { select: { fullName: true, phones: true } } }, orderBy: { licensePlate: 'asc' } },
  _count: { select: { memberships: { where: { revokedAt: null } }, reports: true } },
} as const;

apartmentsRouter.get('/', async (request, response, next) => {
  try {
    const parsed = searchSchema.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_apartment_search' }); return; }
    const { buildingId, query = '', sort = 'apartment', withResidents } = parsed.data;
    const where = {
      ...(buildingId ? { buildingId } : {}),
      ...(withResidents === 'true' ? { memberships: { some: { revokedAt: null } } } : {}),
      ...(query ? {
        OR: [
          { number: { contains: query, mode: 'insensitive' as const } },
          { profile: { is: { people: { some: { fullName: { contains: query, mode: 'insensitive' as const } } } } } },
          { vehicles: { some: { owner: { is: { fullName: { contains: query, mode: 'insensitive' as const } } } } } },
          { memberships: { some: { revokedAt: null, user: { displayName: { contains: query, mode: 'insensitive' as const } } } } },
        ],
      } : {}),
    };
    const items = await prisma.apartment.findMany({ where, include: apartmentInclude });
    if (sort === 'resident') {
      items.sort((left, right) => {
        const leftName = left.profile?.people[0]?.fullName ?? '';
        const rightName = right.profile?.people[0]?.fullName ?? '';
        return leftName.localeCompare(rightName, 'ru') || left.building.address.localeCompare(right.building.address, 'ru') || left.number.localeCompare(right.number, 'ru', { numeric: true });
      });
    } else {
      items.sort((left, right) => left.building.address.localeCompare(right.building.address, 'ru') || left.number.localeCompare(right.number, 'ru', { numeric: true }));
    }
    response.json({
      items: items.slice(0, 100).map(({ inviteCodeHash, ...item }) => ({ ...item, hasInviteCode: Boolean(inviteCodeHash) })),
    });
  } catch (error) { next(error); }
});

apartmentsRouter.patch('/:id', async (request, response, next) => {
  try {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_apartment', details: parsed.error.flatten() }); return; }
    const apartment = await prisma.apartment.findUnique({ where: { id: request.params.id }, include: { profile: { select: { id: true } }, vehicles: { select: { userId: true } }, memberships: { where: { revokedAt: null }, select: { userId: true }, take: 1 } } });
    if (!apartment) { response.status(404).json({ code: 'apartment_not_found' }); return; }
    const duplicate = await prisma.apartment.findFirst({ where: { buildingId: apartment.buildingId, number: parsed.data.number, NOT: { id: apartment.id } }, select: { id: true } });
    if (duplicate) { response.status(409).json({ code: 'apartment_number_taken' }); return; }
    const vehicles = parsed.data.vehicles.map((vehicle) => ({ ...vehicle, licensePlate: normalizePlate(vehicle.licensePlate) }));
    if (new Set(vehicles.map((vehicle) => vehicle.licensePlate)).size !== vehicles.length) { response.status(400).json({ code: 'duplicate_vehicle_plate' }); return; }
    const foreignVehicle = vehicles.length ? await prisma.vehicle.findFirst({ where: { licensePlate: { in: vehicles.map((vehicle) => vehicle.licensePlate) }, apartmentId: { not: apartment.id } }, select: { id: true } }) : null;
    if (foreignVehicle) { response.status(409).json({ code: 'vehicle_belongs_to_another_apartment' }); return; }
    const vehicleUserId = apartment.memberships[0]?.userId ?? apartment.vehicles[0]?.userId;
    if (vehicles.length && !vehicleUserId) { response.status(409).json({ code: 'apartment_has_no_residents' }); return; }
    const item = await prisma.$transaction(async (tx) => {
      await tx.apartment.update({
        where: { id: apartment.id },
        data: {
          number: parsed.data.number,
          ...(parsed.data.inviteCode === undefined
            ? {}
            : { inviteCodeHash: parsed.data.inviteCode === null ? null : hashInviteCode(parsed.data.inviteCode, env.APARTMENT_CODE_PEPPER) }),
        },
      });
      const profile = await tx.residentProfile.upsert({ where: { apartmentId: apartment.id }, create: { apartmentId: apartment.id, residentsCount: parsed.data.residentsCount }, update: { residentsCount: parsed.data.residentsCount } });
      await tx.residentPerson.deleteMany({ where: { profileId: profile.id, isVehicleOwner: false } });
      if (parsed.data.people.length) await tx.residentPerson.createMany({ data: parsed.data.people.map((person) => ({ profileId: profile.id, fullName: person.fullName, phones: person.phones, isVehicleOwner: false })) });
      await tx.vehicle.deleteMany({ where: { apartmentId: apartment.id } });
      await tx.residentPerson.deleteMany({ where: { profileId: profile.id, isVehicleOwner: true } });
      for (const vehicle of vehicles) {
        const owner = await tx.residentPerson.create({ data: { profileId: profile.id, fullName: vehicle.ownerName, phones: vehicle.ownerPhones, isVehicleOwner: true } });
        await tx.vehicle.create({ data: { apartmentId: apartment.id, userId: vehicleUserId!, licensePlate: vehicle.licensePlate, ownerPersonId: owner.id } });
      }
      const admin = response.locals.admin as { id: string };
      await writeAdminAudit(tx, admin.id, 'apartment_updated', 'apartment', apartment.id, {
        peopleCount: parsed.data.people.length,
        vehiclesCount: vehicles.length,
        inviteCodeChanged: parsed.data.inviteCode !== undefined,
      });
      return tx.apartment.findUniqueOrThrow({ where: { id: apartment.id }, include: apartmentInclude });
    });
    response.json({ item });
  } catch (error) { next(error); }
});

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
}

apartmentsRouter.delete('/:id', async (request, response, next) => {
  try {
    const apartment = await prisma.apartment.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!apartment) { response.status(404).json({ code: 'apartment_not_found' }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.residentMembership.deleteMany({ where: { apartmentId: apartment.id } });
      await tx.vehicle.deleteMany({ where: { apartmentId: apartment.id } });
      await tx.residentProfile.deleteMany({ where: { apartmentId: apartment.id } });
      await tx.apartment.delete({ where: { id: apartment.id } });
      const admin = response.locals.admin as { id: string };
      await writeAdminAudit(tx, admin.id, 'apartment_deleted', 'apartment', apartment.id);
    });
    response.status(204).end();
  } catch (error) { next(error); }
});
