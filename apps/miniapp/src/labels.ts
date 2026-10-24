import type { Category, Priority, Role, Status, Zone } from './api';

export const categoryLabels: Record<Category, string> = {
  water: 'Водоснабжение',
  electricity: 'Электричество',
  heating: 'Отопление',
  elevator: 'Лифт',
  leak: 'Протечка',
  cleaning: 'Уборка',
  other: 'Другое',
};

export const zoneLabels: Record<Zone, string> = {
  entrance: 'Подъезд',
  elevator: 'Лифт',
  yard: 'Двор',
  common: 'Другое место в доме',
  apartment: 'Квартира',
};

export const statusLabels: Record<Status, string> = {
  new: 'Новая',
  acknowledged: 'Принята',
  in_progress: 'В работе',
  resolved: 'Устранена',
  rejected: 'Отклонена',
};

export const priorityLabels: Record<Priority, string> = {
  low: 'Не срочная',
  normal: 'Обычная',
  high: 'Срочная',
  emergency: 'Авария',
};

export const roleLabels: Record<Role, string> = {
  // One role for everyone working in a company; "dispatcher" is kept only so
  // that old records read the same.
  dispatcher: 'Администратор УК',
  supervisor: 'Администратор УК',
  platform_admin: 'Администратор платформы',
};

export function place(incident: { locationZone: Zone; entranceNumber: number | null; apartmentNumber?: string | null }) {
  if (incident.locationZone === 'apartment') return incident.apartmentNumber ? `Квартира ${incident.apartmentNumber}` : 'Квартира';
  if (incident.entranceNumber && incident.locationZone === 'entrance') return `Подъезд ${incident.entranceNumber}`;
  if (incident.entranceNumber) return `${zoneLabels[incident.locationZone]}, подъезд ${incident.entranceNumber}`;
  return zoneLabels[incident.locationZone];
}

export function plural(count: number, one: string, few: string, many: string) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

// Dates are shown on the clock of the house: the resident's own house, or
// the company in the desk; an incident card passes the zone of its house.
// Without one, the clock of the phone.
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let displayZone = deviceZone;

export function setDisplayZone(zone: string | null | undefined) {
  displayZone = zone || deviceZone;
}

export function formatDate(value: string | Date, zone = displayZone) {
  return new Date(value).toLocaleString('ru-RU', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(value: string | Date, zone = displayZone) {
  return new Date(value).toLocaleDateString('ru-RU', { timeZone: zone, day: 'numeric', month: 'long' });
}

export function ago(value: string | Date) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return formatDay(value);
}

export function duration(minutes: number | null) {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours * 10) / 10} ч`;
  return `${Math.round(hours / 24)} дн`;
}

export function percent(share: number | null) {
  return share === null ? '—' : `${Math.round(share * 100)}%`;
}

// A Russian phone written the same way everywhere: +7 (XXX) XXX-XX-XX. A
// value that is not a Russian number (or several numbers) is left as typed.
export function formatPhone(value: string) {
  const first = value.split(/[,;]|доб/)[0] ?? value;
  const digits = first.replace(/\D/g, '');
  const national = digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits.length === 10 ? digits : '';
  if (!/^[3489]\d{9}$/.test(national)) return value;
  return `+7 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8)}`;
}

// Search of a house among many: every typed word is found in the address —
// words by their start ("сад" finds "Садовая"), numbers exactly.
const addressNoise = new Set(['ул', 'улица', 'пр', 'просп', 'проспект', 'пер', 'переулок', 'д', 'дом', 'корп', 'корпус', 'к', 'бульвар', 'б', 'р', 'ш', 'шоссе', 'кв', 'квартира']);
function addressWords(text: string) {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/(\d)(\p{L})/gu, '$1 $2').replace(/(\p{L})(\d)/gu, '$1 $2')
    .split(/[^\p{L}\d]+/u).filter((word) => word && !addressNoise.has(word));
}
export function addressMatches(address: string, query: string) {
  const target = addressWords(address);
  const wanted = addressWords(query);
  return wanted.every((word) => target.some((token) => (/^\d+$/.test(word) ? token === word : token.startsWith(word))));
}

// "7, корп. 1" or "61А к2" -> "Ленина, 7" and the lines "Корпус: 1"...
export function addressLines(street: string, house: string, apartment?: string | null) {
  const text = house.replace(/\s+/g, ' ').trim();
  const corpus = /(?:,\s*|\s)(?:корпус|корп\.?|к)\s*([\dа-яa-z]+)/i.exec(text)?.[1] ?? null;
  const building = /(?:,\s*|\s)(?:строение|стр\.?|с)\s*(\d+)/i.exec(text)?.[1] ?? null;
  const number = text.replace(/(?:,\s*|\s)(?:корпус|корп\.?|к|строение|стр\.?|с)\s*[\dа-яa-z]+/gi, '').replace(/,\s*$/, '').trim();
  return {
    main: `${street}, ${number || text}`,
    details: [corpus ? `Корпус: ${corpus}` : null, building ? `Строение: ${building}` : null, apartment ? `Квартира: ${apartment}` : null].filter((line): line is string => Boolean(line)),
  };
}

// "осталось 5 ч" or "просрочено на 2 дн." for the legal term of an incident.
export function termLeft(dueAt: string, now = Date.now()) {
  const left = new Date(dueAt).getTime() - now;
  const total = Math.max(1, Math.round(Math.abs(left) / 3_600_000));
  const spelled = total < 48 ? `${total} ч` : `${Math.round(total / 24)} дн.`;
  return left >= 0 ? `осталось ${spelled}` : `просрочено на ${spelled}`;
}

// Metres between two close points.
export function distance(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  const dy = (left.latitude - right.latitude) * 111_320;
  const dx = (left.longitude - right.longitude) * 111_320 * Math.cos((left.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

// Date and time in the time zone of the company: polls and the reception are
// shown «по местному времени» of its city, whatever the phone says.
export function zoned(value: string | Date, zone: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) {
  return new Date(value).toLocaleString('ru-RU', { ...options, timeZone: zone });
}

// Offset of the zone from Moscow time, the way people in Russia say it:
// «МСК», «МСК+2», «МСК−1».
export function zoneOffset(zone: string, at: Date = new Date()) {
  const minutes = (name: string) => {
    const value = new Intl.DateTimeFormat('en-US', { timeZone: name, timeZoneName: 'shortOffset' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
    const match = /GMT([+-])(\d+)(?::(\d+))?/.exec(value);
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  };
  const shift = minutes(zone) - minutes('Europe/Moscow');
  if (!shift) return 'МСК';
  const hours = Math.floor(Math.abs(shift) / 60);
  const rest = Math.abs(shift) % 60;
  return `МСК${shift > 0 ? '+' : '−'}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

// «2026-10-22» and «10:20» on the wall clock of the zone → the moment.
export function zonedToUtc(date: string, time: string, zone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year!, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const offsetAt = (moment: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(moment)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - moment;
  };
  let moment = wall - offsetAt(wall);
  moment = wall - offsetAt(moment);
  return new Date(moment);
}

// «2 дн. 3 ч 15 мин 30 с» of a number of seconds.
export function spellDuration(seconds: number) {
  const parts: string[] = [];
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (days) parts.push(`${days} дн.`);
  if (hours) parts.push(`${hours} ч`);
  if (minutes) parts.push(`${minutes} мин`);
  if (rest) parts.push(`${rest} с`);
  return parts.join(' ') || '0 с';
}

// «2026-10-22T17:30» for <input type="datetime-local"> on the clock of the zone.
export function toZoneInput(value: string | Date, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// The moment of a value of <input type="datetime-local"> typed for the zone.
export function fromZoneInput(value: string, zone: string) {
  const [date = '', time = '00:00'] = value.split('T');
  return zonedToUtc(date, time, zone);
}
