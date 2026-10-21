import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Real houses of five cities for the map (prisma/data/real-houses.json):
// addresses, floors, flats and years come from open data. Each city gets a
// management company marked as a demo one; there are no residents. Safe to
// run again: houses already in the service are left as they are.

const prisma = new PrismaClient();

// The same hash as src/users/invite-code.ts (the built image has no sources).
const hashInviteCode = (code: string, pepper: string) => createHmac('sha256', pepper).update(code, 'utf8').digest('hex');

type House = { street: string; house: string; latitude: number; longitude: number; floors: number | null; builtYear: number | null; apartments: number; totalArea: number | null; fiasGuid: string | null };
type City = { city: string; region: string; source: string; houses: House[] };

const data = JSON.parse(readFileSync(new URL('./data/real-houses.json', import.meta.url), 'utf8')) as { cities: City[] };

// A stable UUID from a text, so the seed gives the same ids every time.
function stableId(text: string) {
  const hex = createHash('sha256').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// The starting codes of every new house: 0000000000 and 000000 for apartments.
const pepper = process.env.APARTMENT_CODE_PEPPER;
const inviteCodeHash = pepper ? hashInviteCode('000000', pepper) : null;

async function main() {
  let added = 0;
  for (const [index, city] of data.cities.entries()) {
    const companyId = `c0000000-0000-4000-8000-0000000001${String(index + 1).padStart(2, '0')}`;
    const first = city.houses[0]!;
    await prisma.managementCompany.upsert({
      where: { id: companyId },
      update: {},
      create: {
        id: companyId,
        name: `Демо-УК «${city.city}»`,
        phone: `+7 (900) 000-01-${String(index + 1).padStart(2, '0')}`,
        address: `${city.city}, демонстрационный офис`,
        note: 'Демонстрационная управляющая компания: дома реальные, УК условная.',
        latitude: first.latitude,
        longitude: first.longitude,
      },
    });
    for (const house of city.houses) {
      const exists = await prisma.building.findFirst({
        where: { street: { equals: house.street, mode: 'insensitive' }, house: { equals: house.house, mode: 'insensitive' } },
        select: { id: true },
      });
      if (exists) continue;
      const id = stableId(`${city.city}|${house.street}|${house.house}`);
      const entrances = Math.max(1, Math.round(house.apartments / Math.max(1, (house.floors ?? 5) * 4)));
      await prisma.$transaction(async (tx) => {
        await tx.building.create({
          data: {
            id, companyId, city: city.city, street: house.street, house: house.house, address: `${house.street}, ${house.house}`,
            apartmentsCount: house.apartments, entrancesCount: entrances,
            latitude: house.latitude, longitude: house.longitude,
            floors: house.floors, builtYear: house.builtYear, fiasGuid: house.fiasGuid,
            accessCode: '0000000000',
          },
        });
        await tx.apartment.createMany({
          data: Array.from({ length: house.apartments }, (_, number) => ({ buildingId: id, number: String(number + 1), inviteCodeHash })),
          skipDuplicates: true,
        });
      });
      added += 1;
    }
  }
  console.log(`Real houses added: ${added}`);
}

main().finally(async () => prisma.$disconnect());
