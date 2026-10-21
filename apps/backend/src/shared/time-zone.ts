import { prisma } from './prisma.js';

// The local time of a management company: the time zone of the city of its
// houses. Polls and the reception are shown in it, signed «по местному
// времени». Known cities are looked up by name; elsewhere the zone is taken
// by the longitude of the house, in the bands of Russian time zones.

const cityZones: Record<string, string> = {
  'калининград': 'Europe/Kaliningrad',
  'москва': 'Europe/Moscow', 'санкт-петербург': 'Europe/Moscow', 'казань': 'Europe/Moscow', 'нижний новгород': 'Europe/Moscow',
  'ростов-на-дону': 'Europe/Moscow', 'краснодар': 'Europe/Moscow', 'воронеж': 'Europe/Moscow', 'ярославль': 'Europe/Moscow',
  'киров': 'Europe/Kirov', 'пенза': 'Europe/Moscow', 'чебоксары': 'Europe/Moscow', 'йошкар-ола': 'Europe/Moscow',
  'самара': 'Europe/Samara', 'тольятти': 'Europe/Samara', 'ижевск': 'Europe/Samara', 'ульяновск': 'Europe/Ulyanovsk',
  'саратов': 'Europe/Saratov', 'волгоград': 'Europe/Volgograd', 'астрахань': 'Europe/Astrakhan',
  'екатеринбург': 'Asia/Yekaterinburg', 'челябинск': 'Asia/Yekaterinburg', 'пермь': 'Asia/Yekaterinburg', 'тюмень': 'Asia/Yekaterinburg',
  'уфа': 'Asia/Yekaterinburg', 'оренбург': 'Asia/Yekaterinburg', 'курган': 'Asia/Yekaterinburg', 'сургут': 'Asia/Yekaterinburg',
  'магнитогорск': 'Asia/Yekaterinburg', 'нижний тагил': 'Asia/Yekaterinburg',
  'омск': 'Asia/Omsk', 'новосибирск': 'Asia/Novosibirsk', 'томск': 'Asia/Tomsk', 'барнаул': 'Asia/Barnaul',
  'кемерово': 'Asia/Novokuznetsk', 'новокузнецк': 'Asia/Novokuznetsk', 'красноярск': 'Asia/Krasnoyarsk',
  'иркутск': 'Asia/Irkutsk', 'улан-удэ': 'Asia/Irkutsk', 'чита': 'Asia/Chita', 'якутск': 'Asia/Yakutsk',
  'владивосток': 'Asia/Vladivostok', 'хабаровск': 'Asia/Vladivostok', 'магадан': 'Asia/Magadan',
  'южно-сахалинск': 'Asia/Sakhalin', 'петропавловск-камчатский': 'Asia/Kamchatka',
};

const bands: Array<[number, string]> = [
  [22.5, 'Europe/Kaliningrad'], [49.6, 'Europe/Moscow'], [54.5, 'Europe/Samara'], [66, 'Asia/Yekaterinburg'], [75, 'Asia/Omsk'],
  [86, 'Asia/Novosibirsk'], [97.5, 'Asia/Krasnoyarsk'], [113, 'Asia/Irkutsk'], [127, 'Asia/Yakutsk'], [141, 'Asia/Vladivostok'],
  [157, 'Asia/Magadan'], [181, 'Asia/Kamchatka'],
];

export function zoneOf(city: string | null | undefined, longitude: number | null | undefined) {
  const named = city ? cityZones[city.trim().toLowerCase().replace(/ё/g, 'е')] : undefined;
  if (named) return named;
  if (longitude == null) return 'Europe/Moscow';
  return bands.find(([edge]) => longitude < edge)?.[1] ?? 'Europe/Moscow';
}

// The zone of one house: the incidents, comments and deadlines of a house are
// shown on the clock of that house.
export function buildingZone(building: { city?: string | null; longitude?: number | null }) {
  return zoneOf(building.city, building.longitude);
}

export async function companyZone(companyId: string) {
  const [house, company] = await Promise.all([
    prisma.building.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { city: true, longitude: true } }),
    prisma.managementCompany.findUnique({ where: { id: companyId }, select: { longitude: true } }),
  ]);
  return zoneOf(house?.city, house?.longitude ?? company?.longitude);
}

// «23 октября, 17:34 по местному времени (UTC+5)».
export function localTime(date: Date, zone: string, withDay = true) {
  const text = date.toLocaleString('ru-RU', { timeZone: zone, ...(withDay ? { day: 'numeric', month: 'long' } : {}), hour: '2-digit', minute: '2-digit' });
  return `${text} по местному времени (${offsetLabel(date, zone)})`;
}

export function offsetLabel(date: Date, zone: string) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  return name.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0');
}

// «22.10.2026, 17:34» on the clock of the zone.
export function formatInZone(date: Date, zone: string) {
  return date.toLocaleString('ru-RU', { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
