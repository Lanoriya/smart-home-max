import { isWorkingDay } from '../shared/holidays.js';

// The longest time the law gives a management company for an incident, by its
// kind. Sources:
// - ПП РФ № 416 от 15.05.2013 (Правила управления МКД): аварийно-диспетчерская
//   служба локализует аварию не позднее 30 минут с регистрации заявки и
//   устраняет аварийные повреждения не позднее 3 суток; обращение
//   собственника рассматривается не позднее 10 рабочих дней;
// - Постановление Госстроя РФ № 170 от 27.09.2003, приложение № 2: сроки
//   устранения неисправностей (лифт, кровля, краны — 1 сутки; освещение мест
//   общего пользования — 7 суток; автоматы защиты и ВРУ — 3 часа);
// - ПП РФ № 354 от 06.05.2011, приложение № 1: перерыв отопления не более
//   16 часов подряд.
// The contract of a house may set shorter terms; these are the longest.

export type LegalTerm = {
  // What has to happen in that time.
  title: string;
  // The deadline counted from the incident.
  dueAt: Date;
  // The first step for emergencies: localisation within 30 minutes.
  firstStep: string | null;
  source: string;
};

// The time zone of the house: working days are counted on its calendar.
type Input = { category: string; priority: string; locationZone: string; createdAt: Date; timeZone?: string | undefined };

const hours = (from: Date, count: number) => new Date(from.getTime() + count * 3_600_000);

// The date of a moment on the clock of the zone.
function localDate(moment: Date, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(moment).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// The same time of day after the given number of working days of the house,
// weekends and public holidays skipped.
export function workingDays(from: Date, count: number, zone = 'Europe/Moscow') {
  const start = localDate(from, zone);
  const date = new Date(Date.UTC(start.year, start.month - 1, start.day));
  let days = 0;
  let left = count;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    days += 1;
    if (isWorkingDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())) left -= 1;
  }
  return new Date(from.getTime() + days * 24 * 3_600_000);
}

export function legalTermOf(incident: Input): LegalTerm {
  const { category, priority, locationZone, createdAt, timeZone } = incident;
  if (priority === 'emergency') {
    return { title: 'устранить аварию — до 3 суток', dueAt: hours(createdAt, 72), firstStep: 'локализовать — до 30 минут', source: 'ПП РФ № 416' };
  }
  switch (category) {
    case 'leak':
      return { title: 'устранить протечку — до 1 суток', dueAt: hours(createdAt, 24), firstStep: 'течь трубопровода — локализовать до 30 минут', source: 'Постановление Госстроя № 170, прил. 2; ПП РФ № 416' };
    case 'elevator':
      return { title: 'починить лифт — до 1 суток', dueAt: hours(createdAt, 24), firstStep: null, source: 'Постановление Госстроя № 170, прил. 2' };
    case 'water':
      return { title: 'устранить неисправность — до 1 суток', dueAt: hours(createdAt, 24), firstStep: null, source: 'Постановление Госстроя № 170, прил. 2' };
    case 'heating':
      return { title: 'вернуть отопление — до 16 часов', dueAt: hours(createdAt, 16), firstStep: null, source: 'ПП РФ № 354, прил. 1' };
    case 'electricity':
      return locationZone === 'apartment'
        ? { title: 'устранить неисправность автоматов и щитов — до 3 часов', dueAt: hours(createdAt, 3), firstStep: null, source: 'Постановление Госстроя № 170, прил. 2' }
        : { title: 'починить освещение мест общего пользования — до 7 суток', dueAt: hours(createdAt, 24 * 7), firstStep: null, source: 'Постановление Госстроя № 170, прил. 2' };
    default:
      return { title: 'рассмотреть обращение и ответить — до 10 рабочих дней', dueAt: workingDays(createdAt, 10, timeZone), firstStep: null, source: 'ПП РФ № 416' };
  }
}

// "до 1 суток, осталось 5 ч" — for the bot and notifications.
export function legalTermLine(term: LegalTerm, now = new Date()) {
  const left = term.dueAt.getTime() - now.getTime();
  const spell = (ms: number) => {
    const total = Math.max(1, Math.round(ms / 3_600_000));
    return total < 48 ? `${total} ч` : `${Math.round(total / 24)} дн.`;
  };
  return `${term.title}${term.firstStep ? `; ${term.firstStep}` : ''} (${term.source}). ${left >= 0 ? `Осталось ${spell(left)}` : `Просрочено на ${spell(-left)}`}.`;
}
