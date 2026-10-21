import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import type { AdminActor } from '../auth/scope.js';
import { env } from '../config/env.js';
import { hashInviteCode } from '../users/invite-code.js';
import { composeAddress } from './address.js';

// Adding a house to a company: the web dispatcher desk and the mini-app map
// use the same rules.

export const buildingSchema = z.object({
  street: z.string().trim().min(2).max(200),
  house: z.string().trim().min(1).max(60),
  city: z.string().trim().max(100).nullable().optional().transform((value) => value || null),
  apartmentsCount: z.number().int().min(1).max(2000),
  entrancesCount: z.number().int().min(1).max(50),
  chatLink: z.string().trim().max(500).nullable().optional().refine((value) => !value || isUsableLink(value), { message: 'Expected a public http(s) link' }),
  // Point on the map; both or neither.
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  // Filled in from the open housing registry when the house was found there.
  fiasGuid: z.string().trim().max(64).nullable().optional(),
  floors: z.number().int().min(1).max(200).nullable().optional(),
  builtYear: z.number().int().min(1700).max(2100).nullable().optional(),
}).refine((value) => (value.latitude == null) === (value.longitude == null), { message: 'Latitude and longitude go together', path: ['latitude'] }).transform(({ latitude, longitude, fiasGuid, floors, builtYear, ...value }) => ({
  // Registry details: a form that does not send them keeps the stored ones.
  ...(fiasGuid === undefined ? {} : { fiasGuid }),
  ...(floors === undefined ? {} : { floors }),
  ...(builtYear === undefined ? {} : { builtYear }),
  ...value,
  street: value.street.replace(/\s+/g, ' '),
  address: composeAddress(value.street.replace(/\s+/g, ' '), value.house),
  // A form without a point keeps the current one.
  ...(latitude === undefined ? {} : { latitude, longitude: longitude ?? null }),
}));

// The same street and house typed with different case or spacing is one
// building — in one city: the same address in another city is another house.
// One house is managed by one company at a time.
export async function findDuplicate(street: string, house: string, exceptId?: string, city?: string | null) {
  return prisma.building.findFirst({
    where: {
      street: { equals: street, mode: 'insensitive' }, house: { equals: house, mode: 'insensitive' },
      ...(city ? { OR: [{ city: { equals: city, mode: 'insensitive' as const } }, { city: null }] } : {}),
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
}

// Codes a new house starts with, the same for every house so that a pilot can
// be shown without handing out codes. The company changes the house code in
// the house card and sets personal apartment codes in the web desk.
export const defaultBuildingCode = '0000000000';
export const defaultApartmentCode = '000000';
export function defaultApartmentCodeHash() {
  return hashInviteCode(defaultApartmentCode, env.APARTMENT_CODE_PEPPER);
}

export type BuildingInput = z.infer<typeof buildingSchema>;

export async function createBuilding(admin: AdminActor, companyId: string, data: BuildingInput) {
  if (await findDuplicate(data.street, data.house, undefined, data.city)) return { ok: false as const, code: 'building_exists' };
  const item = await prisma.$transaction(async (tx) => {
    const building = await tx.building.create({ data: { ...data, companyId, chatLink: data.chatLink || null, accessCode: defaultBuildingCode } });
    const inviteCodeHash = defaultApartmentCodeHash();
    await tx.apartment.createMany({
      data: Array.from({ length: data.apartmentsCount }, (_, index) => ({
        buildingId: building.id,
        number: String(index + 1),
        inviteCodeHash,
      })),
    });
    await writeAdminAudit(tx, admin.id, 'building_created', 'building', building.id, {
      apartmentsCount: data.apartmentsCount,
      entrancesCount: data.entrancesCount,
      companyId,
    });
    return building;
  });
  return { ok: true as const, item };
}

// The chat link becomes a button in the bot, and MAX refuses buttons with
// links it cannot open. Only public http(s) addresses are accepted; reserved
// test domains such as example.invalid are not.
const reservedSuffixes = ['.invalid', '.test', '.local', '.localhost', '.example'];
export function isUsableLink(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && host.includes('.') && !reservedSuffixes.some((suffix) => host.endsWith(suffix)) && !['example.com', 'example.org', 'example.net'].includes(host);
  } catch {
    return false;
  }
}
