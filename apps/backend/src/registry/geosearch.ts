import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

// Search of any city and any street or house in it, as the person types.
// Nominatim forbids search-as-you-type, so suggestions come from Photon — a
// geocoder over the same OpenStreetMap data made for it. Requests go through
// the backend with a cache, so the public service is not hit on every key.

const featureSchema = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    name: z.string().optional(),
    street: z.string().optional(),
    housenumber: z.string().optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    countrycode: z.string().optional(),
    osm_key: z.string().optional(),
    osm_value: z.string().optional(),
    type: z.string().optional(),
    // [west, north, east, south] for places.
    extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  }).passthrough(),
});
const responseSchema = z.object({ features: z.array(featureSchema) });

const cache = new Map<string, z.infer<typeof responseSchema>['features']>();

async function photon(params: Record<string, string | string[]>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  const key = search.toString();
  if (cache.has(key)) return cache.get(key)!;
  try {
    const response = await fetch(`${env.SUGGEST_URL}/api/?${key}`, {
      headers: { 'user-agent': `Domoved/0.1 (${env.MINIAPP_URL ?? 'hackathon MAX'})` },
      signal: AbortSignal.timeout(6000),
    });
    const parsed = response.ok ? responseSchema.safeParse(await response.json()) : null;
    const features = parsed?.success ? parsed.data.features : [];
    if (cache.size > 5000) cache.clear();
    cache.set(key, features);
    return features;
  } catch (error) {
    logger.warn({ error }, 'Address suggestions failed');
    return [];
  }
}

export type CitySuggestion = { name: string; region: string | null; latitude: number; longitude: number; extent: [number, number, number, number] | null };

const fold = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/ё/g, 'е').trim();

// Size of a place, bigger first. A village that shares its name with a city
// ("Тюмень" in the Kirov region) is dropped when that city is in the list:
// people looking for Tyumen mean the city.
const placeRank: Record<string, number> = { city: 0, town: 1, village: 2, hamlet: 3 };

export async function suggestCities(query: string): Promise<CitySuggestion[]> {
  const features = await photon({ q: query, limit: '12', lang: 'default', osm_tag: ['place:city', 'place:town', 'place:village', 'place:hamlet'] });
  const seen = new Set<string>();
  const places = features
    .filter((feature) => !feature.properties.countrycode || feature.properties.countrycode === 'RU')
    .map((feature) => ({
      city: {
        name: feature.properties.name ?? '',
        region: feature.properties.state ?? null,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        extent: feature.properties.extent ?? null,
      },
      rank: placeRank[feature.properties.osm_value ?? ''] ?? 3,
    }))
    .filter(({ city }) => {
      const key = `${fold(city.name)}|${city.region}`;
      if (!city.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const townNames = new Set(places.filter((place) => place.rank <= 1).map((place) => fold(place.city.name)));
  // Fuzzy matches ("Тюсмень" for "Тюмень") only when nothing starts with the text.
  const typed = fold(query);
  const prefixed = places.some((place) => fold(place.city.name).startsWith(typed));
  return places
    .filter((place) => !prefixed || fold(place.city.name).startsWith(typed))
    .filter((place) => place.rank <= 1 || !townNames.has(fold(place.city.name)))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 8)
    .map((place) => place.city);
}

export type AddressSuggestion = {
  street: string;
  house: string | null;
  city: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
};

// "ул. Ленина, д. 14, корп. 2" -> "Ленина 14 к2": the words a person types
// around an address are dropped, a corpus is written the way OSM writes it.
export function normaliseAddressQuery(query: string) {
  return query
    .replace(/ё/gi, 'е')
    .replace(/[,.]/g, ' ')
    .replace(/(^|\s)(ул|улица|пр|пр-кт|проспект|пер|переулок|б-р|бульвар|ш|шоссе|д|дом)(?=\s|$)/gi, ' ')
    .replace(/(\d+[а-яa-z]?)\s*(?:корпус|корп|к)\s*(\d+)/gi, '$1 к$2')
    .replace(/(\d+[а-яa-z]?)\s*(?:строение|стр)\s*(\d+)/gi, '$1 с$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export type CityRef = { name: string; region?: string | null; latitude: number; longitude: number; extent?: [number, number, number, number] | null };

function insideCity(city: CityRef, point: { latitude: number; longitude: number }) {
  if (city.extent) {
    const [west, north, east, south] = city.extent;
    const margin = 0.02;
    return point.longitude >= west - margin && point.longitude <= east + margin && point.latitude >= south - margin && point.latitude <= north + margin;
  }
  // Without borders: within 30 km of the centre.
  const dx = (point.longitude - city.longitude) * 111 * Math.cos((city.latitude * Math.PI) / 180);
  const dy = (point.latitude - city.latitude) * 111;
  return Math.sqrt(dx * dx + dy * dy) < 30;
}

// Streets and houses of the chosen city. Results are kept by the borders and
// the region of the city, not by its name: OSM often leaves the city of a house
// empty, and two towns can share a name.
export async function suggestAddresses(query: string, city?: CityRef): Promise<AddressSuggestion[]> {
  const text = normaliseAddressQuery(query);
  const features = await photon({
    q: city ? `${text} ${city.name}` : text,
    limit: '15',
    lang: 'default',
    layer: ['house', 'street'],
    ...(city ? { lat: String(city.latitude), lon: String(city.longitude) } : {}),
    ...(city?.extent ? { bbox: city.extent.join(',') } : {}),
  });
  const typedNumber = /(\d+(?:\/\d+)?[а-яa-z]?(?:\s?[кс]\d+)?)\s*$/i.exec(text)?.[1]?.replace(/\s/g, '').toLowerCase() ?? null;
  const seen = new Set<string>();
  const items = features
    .map((feature) => {
      const { properties } = feature;
      const isStreet = properties.osm_key === 'highway' || properties.type === 'street';
      return {
        street: (isStreet ? properties.name : properties.street) ?? '',
        house: isStreet ? null : properties.housenumber ?? null,
        city: properties.city ?? city?.name ?? null,
        region: properties.state ?? null,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
      };
    })
    .filter((item) => item.street && (item.house || !typedNumber))
    .filter((item) => !city || (insideCity(city, item) && (!city.region || !item.region || fold(item.region) === fold(city.region))))
    .filter((item) => {
      const key = `${fold(item.street)}|${fold(item.house)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // The house with exactly the typed number goes first.
  if (typedNumber) items.sort((left, right) => Number(fold(right.house).replace(/\s/g, '') === typedNumber) - Number(fold(left.house).replace(/\s/g, '') === typedNumber));
  return items.slice(0, 8);
}

// One precise search when the person presses "Найти" (Nominatim allows a
// search on demand, only not as-you-type).
const resolvedSchema = z.array(z.object({ lat: z.string(), lon: z.string(), address: z.record(z.string(), z.string()).optional() }));

async function nominatimSearch(text: string, city: CityRef) {
  const url = new URL('/search', env.GEOCODER_URL);
  url.search = new URLSearchParams({ q: `${text}, ${city.name}${city.region ? `, ${city.region}` : ''}`, format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'ru', countrycodes: 'ru' }).toString();
  // Nominatim allows about one request a second; a refusal is tried once more.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': `Domoved/0.1 (${env.MINIAPP_URL ?? 'hackathon MAX'})` }, signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const results = resolvedSchema.safeParse(await response.json());
      return results.success ? results.data : [];
    }
    if (response.status !== 429 && response.status < 500) return [];
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return [];
}

export async function resolveAddress(query: string, city: CityRef): Promise<AddressSuggestion | null> {
  const text = normaliseAddressQuery(query);
  try {
    // A geocoder that does not answer is not the end: the other one is asked.
    const inside = (await nominatimSearch(text, city).catch((error: unknown) => { logger.warn({ error }, 'Nominatim search failed'); return []; })).filter((item) => insideCity(city, { latitude: Number(item.lat), longitude: Number(item.lon) }));
    // A house is better than its street: the first result is sometimes the street.
    const found = inside.find((item) => item.address?.house_number) ?? inside[0];
    if (!found?.address?.house_number) {
      // The other geocoder, when it has a house with exactly the typed number.
      const typed = /(\d+(?:\/\d+)?[а-яa-z]?(?:\s?[кс]\d+)?)\s*$/i.exec(text)?.[1]?.replace(/\s/g, '').toLowerCase();
      const exact = typed ? (await suggestAddresses(text, city)).find((item) => item.house?.replace(/\s/g, '').toLowerCase() === typed) : undefined;
      if (exact) return exact;
    }
    if (!found) return null;
    return {
      street: found.address?.road ?? found.address?.pedestrian ?? text,
      house: found.address?.house_number ?? null,
      city: city.name,
      region: found.address?.state ?? city.region ?? null,
      latitude: Number(found.lat),
      longitude: Number(found.lon),
    };
  } catch (error) {
    logger.warn({ error }, 'Address resolution failed');
    return null;
  }
}

// The point of a free-written address, such as the office of a company:
// "г. Тюмень, ул. Газовиков, д. 69, п. 3". The entrance, office or room is
// dropped — geocoders know houses, not doors.
export function addressForGeocoder(address: string) {
  return address
    .replace(/,?\s*(?:п\.|подъезд|оф\.?|офис|пом\.?|помещение|кв\.?|каб\.?|кабинет|эт\.?|этаж)\s*[\dа-яa-z-]+/gi, '')
    .replace(/^\s*\d{6},?\s*/, '')
    .replace(/(^|[\s,])(?:г|гор|город|ул|улица|д|дом|пр-кт|просп|проспект|пер|переулок|б-р|бульвар|ш|шоссе|мкр|микрорайон)\.?(?=\s)/gi, '$1')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function locateAddress(address: string): Promise<{ latitude: number; longitude: number } | null> {
  const text = addressForGeocoder(address);
  if (text.length < 5) return null;
  try {
    const url = new URL('/search', env.GEOCODER_URL);
    url.search = new URLSearchParams({ q: text, format: 'jsonv2', addressdetails: '1', limit: '8', 'accept-language': 'ru', countrycodes: 'ru' }).toString();
    const response = await fetch(url, { headers: { 'user-agent': `Domoved/0.1 (${env.MINIAPP_URL ?? 'hackathon MAX'})` }, signal: AbortSignal.timeout(8000) });
    const results = response.ok ? resolvedSchema.safeParse(await response.json()) : null;
    const found = results?.success ? bestFor(text, results.data) : undefined;
    if (found) return { latitude: Number(found.lat), longitude: Number(found.lon) };
  } catch (error) {
    logger.warn({ error }, 'Nominatim search failed');
  }
  const [feature] = await photon({ q: text, limit: '1', lang: 'default' });
  return feature ? { latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0] } : null;
}

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
