import { PrismaClient } from '@prisma/client';

// Puts on the map the offices of companies that have an address but no point:
// found by the address with OpenStreetMap (Nominatim, one request a second).
// The entrance or office number is dropped — the geocoder knows houses.
//   tsx prisma/locate-offices.ts

const prisma = new PrismaClient();
const geocoder = process.env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function forGeocoder(address: string) {
  return address
    .replace(/,?\s*(?:п\.|подъезд|оф\.?|офис|пом\.?|помещение|кв\.?|каб\.?|кабинет|эт\.?|этаж)\s*[\dа-яa-z-]+/gi, '')
    .replace(/^\s*\d{6},?\s*/, '')
    .replace(/(^|[\s,])(?:г|гор|город|ул|улица|д|дом|пр-кт|просп|проспект|пер|переулок|б-р|бульвар|ш|шоссе|мкр|микрорайон)\.?(?=\s)/gi, '$1')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

async function locate(address: string) {
  const url = new URL('/search', geocoder);
  url.search = new URLSearchParams({ q: forGeocoder(address), format: 'jsonv2', addressdetails: '1', limit: '8', 'accept-language': 'ru', countrycodes: 'ru' }).toString();
  const response = await fetch(url, { headers: { 'user-agent': 'Domoved/0.1 (hackathon MAX)' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) return null;
  const results = await response.json() as Array<{ lat: string; lon: string; address?: Record<string, string> }>;
  const found = bestFor(forGeocoder(address), results);
  return found ? { latitude: Number(found.lat), longitude: Number(found.lon) } : null;
}

async function main() {
  const companies = await prisma.managementCompany.findMany({ where: { address: { not: null }, OR: [{ latitude: null }, { longitude: null }] }, select: { id: true, name: true, address: true } });
  let located = 0;
  for (const company of companies) {
    const point = await locate(company.address!).catch(() => null);
    if (point) { await prisma.managementCompany.update({ where: { id: company.id }, data: point }); located += 1; }
    console.log(`${point ? 'ok ' : '-- '} ${company.name}: ${company.address}`);
    await sleep(1100);
  }
  console.log(`Offices located: ${located} of ${companies.length}`);
}

main().finally(() => prisma.$disconnect());

// A house in the city written in the address goes first: "Ленина, 24" is in
// many towns around a big city.
function bestFor<T extends { address?: Record<string, string> | undefined }>(text: string, results: T[]) {
  const written = text.toLowerCase().replace(/ё/g, 'е');
  const inCity = (item: T) => ['city', 'town', 'village'].some((key) => {
    const place = item.address?.[key]?.toLowerCase().replace(/ё/g, 'е');
    return Boolean(place && written.includes(place));
  });
  // The house with exactly the written number, then any house of the city.
  const number = /(\d+[а-яa-z]?(?:\/\d+)?)\s*$/i.exec(written.replace(/[,\s]+$/, ''))?.[1];
  const exact = (item: T) => Boolean(number && item.address?.house_number?.toLowerCase().replace(/\s/g, '') === number);
  return results.find((item) => inCity(item) && exact(item)) ?? results.find((item) => inCity(item) && item.address?.house_number) ?? results.find(inCity) ?? results.find((item) => item.address?.house_number) ?? results[0];
}
