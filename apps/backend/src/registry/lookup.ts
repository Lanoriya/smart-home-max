import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { prisma } from '../shared/prisma.js';
import { houseKey, streetKey } from './address.js';

// What can be learned about a house from a point on the map, and where each
// piece came from. Whatever is not found stays empty for the person to fill in.

export type Source = 'map' | 'registry' | 'service';

export type HouseLookup = {
  point: { latitude: number; longitude: number };
  address: { street: string; house: string; locality: string | null; region: string | null; display: string } | null;
  details: {
    floors: number | null;
    apartments: number | null;
    builtYear: number | null;
    residents: number | null;
    totalArea: number | null;
    fiasGuid: string | null;
  };
  // Field -> where its value came from.
  filled: Record<string, Source>;
  // The house is already in the service.
  existing: { id: string; address: string; company: { id: string; name: string } } | null;
  registryAddress: string | null;
};

const nominatimSchema = z.object({
  address: z.object({
    road: z.string().optional(),
    pedestrian: z.string().optional(),
    house_number: z.string().optional(),
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    hamlet: z.string().optional(),
    state: z.string().optional(),
  }).partial().optional(),
  extratags: z.record(z.string(), z.string()).nullish(),
}).passthrough();

// OpenStreetMap asks for at most one request a second and a real User-Agent.
let lastRequestAt = 0;
const cache = new Map<string, z.infer<typeof nominatimSchema> | null>();

async function reverseGeocode(latitude: number, longitude: number) {
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key)!;
  const wait = lastRequestAt + 1100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const url = new URL('/reverse', env.GEOCODER_URL);
  url.search = new URLSearchParams({ format: 'jsonv2', lat: String(latitude), lon: String(longitude), zoom: '18', layer: 'address', addressdetails: '1', extratags: '1', 'accept-language': 'ru' }).toString();
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': `Domoved/0.1 (${env.MINIAPP_URL ?? 'hackathon MAX'})` },
      signal: AbortSignal.timeout(8000),
    });
    const parsed = response.ok ? nominatimSchema.safeParse(await response.json()) : null;
    const result = parsed?.success ? parsed.data : null;
    if (cache.size > 2000) cache.clear();
    cache.set(key, result);
    return result;
  } catch (error) {
    logger.warn({ error }, 'Reverse geocoding failed');
    return null;
  }
}

const number = (value: string | undefined) => {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export async function lookupHouse(latitude: number, longitude: number): Promise<HouseLookup> {
  const point = { latitude, longitude };
  const details: HouseLookup['details'] = { floors: null, apartments: null, builtYear: null, residents: null, totalArea: null, fiasGuid: null };
  const filled: Record<string, Source> = {};
  const geo = await reverseGeocode(latitude, longitude);
  const road = geo?.address?.road ?? geo?.address?.pedestrian;
  const houseNumber = geo?.address?.house_number;
  const locality = geo?.address?.city ?? geo?.address?.town ?? geo?.address?.village ?? geo?.address?.hamlet ?? null;
  if (!road || !houseNumber) return { point, address: null, details, filled, existing: null, registryAddress: null };

  const address = { street: road, house: houseNumber, locality, region: geo?.address?.state ?? null, display: `${road}, ${houseNumber}` };
  filled.street = 'map';
  filled.house = 'map';
  const levels = number(geo?.extratags?.['building:levels']);
  const flats = number(geo?.extratags?.['building:flats']);
  if (levels) { details.floors = levels; filled.floors = 'map'; }
  if (flats) { details.apartments = flats; filled.apartments = 'map'; }

  const keys = { streetKey: streetKey(road), houseKey: houseKey(houseNumber) };
  const candidates = await prisma.registryHouse.findMany({ where: keys, take: 10 });
  const localityKey = locality?.toLowerCase().replace(/ё/g, 'е') ?? null;
  const match = candidates.find((house) => localityKey && house.locality === localityKey) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (match) {
    // The registry is the official source and wins over the map.
    const fromRegistry = { floors: match.floors, apartments: match.apartments, builtYear: match.builtYear, residents: match.residents, totalArea: match.totalArea, fiasGuid: match.fiasGuid };
    for (const [field, value] of Object.entries(fromRegistry)) {
      if (value !== null && value !== undefined) {
        (details as Record<string, unknown>)[field] = value;
        filled[field] = 'registry';
      }
    }
  }

  // Is the house already connected? Addresses are compared by the same keys,
  // within the same city: "Ленина, 5" is a different house in another town.
  const sameHouse = await prisma.building.findMany({
    where: {
      house: { contains: houseNumber.replace(/\s.*$/, ''), mode: 'insensitive' },
      ...(locality ? { OR: [{ city: { equals: locality, mode: 'insensitive' as const } }, { city: null }] } : {}),
    },
    select: { id: true, address: true, street: true, house: true, company: { select: { id: true, name: true } } },
    take: 50,
  });
  const existing = sameHouse.find((building) => streetKey(building.street) === keys.streetKey && houseKey(building.house) === keys.houseKey) ?? null;

  return {
    point,
    address,
    details,
    filled,
    existing: existing ? { id: existing.id, address: existing.address, company: existing.company } : null,
    registryAddress: match?.address ?? null,
  };
}

export async function searchRegistryCompanies(query: string, subject?: string, city?: string) {
  const value = query.trim();
  const byInn = /^\d{10}(\d{2})?$/.test(value);
  const items = await prisma.registryCompany.findMany({
    where: byInn
      ? { inn: value }
      : {
        ...(subject ? { subject } : {}),
        ...(city ? { OR: [{ actualAddress: { contains: city, mode: 'insensitive' as const } }, { legalAddress: { contains: city, mode: 'insensitive' as const } }] } : {}),
        // Every word must appear; long words are matched by their stem so
        // that "Северная" also finds "Северный".
        AND: stems(value).map((stem) => ({
          OR: [
            { nameFull: { contains: stem, mode: 'insensitive' as const } },
            { nameShort: { contains: stem, mode: 'insensitive' as const } },
          ],
        })),
      },
    orderBy: { housesCount: { sort: 'desc', nulls: 'last' } },
    take: 10,
  });
  const connected = await prisma.managementCompany.findMany({
    where: { inn: { in: items.map((item) => item.inn).filter((inn): inn is string => Boolean(inn)) } },
    select: { id: true, inn: true },
  });
  const byConnectedInn = new Map(connected.map((company) => [company.inn, company.id]));
  return items.map((item) => ({ ...item, connectedCompanyId: item.inn ? byConnectedInn.get(item.inn) ?? null : null }));
}

export function stems(query: string) {
  return query.toLowerCase().replace(/ё/g, 'е').replace(/["«»]/g, ' ').split(/\s+/).filter((word) => word.length >= 2)
    .map((word) => (word.length >= 6 ? word.slice(0, -2) : word)).slice(0, 5);
}
