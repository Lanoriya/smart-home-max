// Dates of the desk on the right clock. An incident is shown in the zone of
// its house (the API sends it with every incident); other dates of a company
// in the zone of the company; without one, in the zone of this computer.

const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let deskZone = deviceZone;

export function setDeskZone(zone: string | null | undefined) {
  deskZone = zone || deviceZone;
}

export function currentDeskZone() {
  return deskZone;
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

// «2026-10-22T17:30» for <input type="datetime-local"> on the clock of the zone.
export function toZoneInput(value: string, zone = deskZone) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const item = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${item('year')}-${item('month')}-${item('day')}T${item('hour')}:${item('minute')}`;
}

// The moment of a wall-clock time typed for the zone.
export function zoneInputToIso(value: string, zone = deskZone) {
  const [date = '', time = '00:00'] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year!, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const offsetAt = (moment: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(moment)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - moment;
  };
  let moment = wall - offsetAt(wall);
  moment = wall - offsetAt(moment);
  return new Date(moment).toISOString();
}

export function formatShortDate(value: string, zone = deskZone) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function formatFullDate(value: string, zone = deskZone) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function formatDay(value: string, zone = deskZone) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}
