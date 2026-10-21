// Days off of the Russian production calendar, for the terms counted in
// working days. Holidays are those of art. 112 of the Labour Code; a holiday
// that falls on a weekend moves to the next working day, except the January
// ones, which the Government moves by a decree each year. Those decrees are
// listed below year by year: extra days off and working Saturdays.

const holidays = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04'];

// Постановление Правительства РФ о переносе выходных дней в 2026 году:
// 3 января → 9 января, 4 января → 31 декабря.
const extraDaysOff: Record<number, string[]> = {
  2026: ['01-09', '12-31'],
};
const workingWeekends: Record<number, string[]> = {};

const key = (month: number, day: number) => `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function weekday(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const isWeekend = (year: number, month: number, day: number) => [0, 6].includes(weekday(year, month, day));

// Holidays of the year that fell on a weekend and the days off they moved to.
function movedDaysOff(year: number) {
  const moved = new Set<string>();
  for (const holiday of holidays) {
    const [month, day] = holiday.split('-').map(Number) as [number, number];
    if (month === 1 || !isWeekend(year, month, day)) continue;
    const date = new Date(Date.UTC(year, month - 1, day));
    do {
      date.setUTCDate(date.getUTCDate() + 1);
    } while ([0, 6].includes(date.getUTCDay()) || holidays.includes(key(date.getUTCMonth() + 1, date.getUTCDate())) || moved.has(key(date.getUTCMonth() + 1, date.getUTCDate())));
    moved.add(key(date.getUTCMonth() + 1, date.getUTCDate()));
  }
  return moved;
}

const movedCache = new Map<number, Set<string>>();

export function isWorkingDay(year: number, month: number, day: number) {
  const date = key(month, day);
  if (workingWeekends[year]?.includes(date)) return true;
  if (isWeekend(year, month, day) || holidays.includes(date) || extraDaysOff[year]?.includes(date)) return false;
  if (!movedCache.has(year)) movedCache.set(year, movedDaysOff(year));
  return !movedCache.get(year)!.has(date);
}
