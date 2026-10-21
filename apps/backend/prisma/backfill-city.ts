import { PrismaClient } from '@prisma/client';

// Puts the city on houses connected before the city was stored: found by the
// point of the house with OpenStreetMap (Nominatim, one request a second).
//   tsx prisma/backfill-city.ts

const prisma = new PrismaClient();
const geocoder = process.env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cityAt(latitude: number, longitude: number) {
  const url = new URL('/reverse', geocoder);
  url.search = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: 'jsonv2', zoom: '10', addressdetails: '1', 'accept-language': 'ru' }).toString();
  const response = await fetch(url, { headers: { 'user-agent': 'Domoved/0.1 (city backfill)' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const body = await response.json() as { address?: Record<string, string> };
  return body.address?.city ?? body.address?.town ?? body.address?.village ?? null;
}

async function main() {
  const houses = await prisma.building.findMany({ where: { city: null, latitude: { not: null }, longitude: { not: null } }, select: { id: true, address: true, latitude: true, longitude: true } });
  let filled = 0;
  for (const house of houses) {
    try {
      const city = await cityAt(house.latitude!, house.longitude!);
      if (city) {
        await prisma.building.update({ where: { id: house.id }, data: { city } });
        filled += 1;
      } else {
        console.log(`no city: ${house.address}`);
      }
    } catch (error) {
      console.log(`failed: ${house.address}: ${(error as Error).message}`);
    }
    await sleep(1100);
  }
  console.log(`Cities filled: ${filled} of ${houses.length}`);
}

main().finally(async () => prisma.$disconnect());
