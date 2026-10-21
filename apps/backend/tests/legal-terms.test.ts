import { describe, expect, it } from 'vitest';
import { legalTermLine, legalTermOf, workingDays } from '../src/incidents/legal-terms.js';
import { isWorkingDay } from '../src/shared/holidays.js';

const at = new Date('2026-10-23T09:00:00Z'); // a Friday

describe('legal terms of incidents', () => {
  it('gives an emergency three days and the first step of 30 minutes', () => {
    const term = legalTermOf({ category: 'water', priority: 'emergency', locationZone: 'common', createdAt: at });
    expect(term.dueAt.getTime() - at.getTime()).toBe(72 * 3_600_000);
    expect(term.firstStep).toContain('30 минут');
  });

  it('gives an elevator one day and lighting of the entrance seven', () => {
    expect(legalTermOf({ category: 'elevator', priority: 'normal', locationZone: 'elevator', createdAt: at }).dueAt.getTime() - at.getTime()).toBe(24 * 3_600_000);
    expect(legalTermOf({ category: 'electricity', priority: 'normal', locationZone: 'entrance', createdAt: at }).dueAt.getTime() - at.getTime()).toBe(7 * 24 * 3_600_000);
  });

  it('counts ten working days for an ordinary request, skipping weekends and holidays', () => {
    // 4 November, the Day of National Unity, is not a working day.
    const term = legalTermOf({ category: 'other', priority: 'normal', locationZone: 'common', createdAt: at, timeZone: 'Asia/Yekaterinburg' });
    expect(term.dueAt.toISOString().slice(0, 10)).toBe('2026-11-09');
  });

  it('counts the working days on the calendar of the house', () => {
    // Friday 23:30 in Vladivostok is already Saturday there.
    const late = new Date('2026-10-23T13:30:00Z');
    expect(workingDays(late, 1, 'Europe/Moscow').toISOString().slice(0, 10)).toBe('2026-10-26');
    expect(workingDays(late, 1, 'Asia/Vladivostok').toISOString().slice(0, 10)).toBe('2026-10-26');
    expect(workingDays(new Date('2026-10-23T15:30:00Z'), 1, 'Asia/Vladivostok').getTime() - new Date('2026-10-23T15:30:00Z').getTime()).toBe(2 * 24 * 3_600_000); // Saturday 01:30 there → Monday 01:30
  });

  it('says how much time is left or how late it is', () => {
    const term = legalTermOf({ category: 'leak', priority: 'normal', locationZone: 'common', createdAt: at });
    expect(legalTermLine(term, new Date(at.getTime() + 19 * 3_600_000))).toContain('Осталось 5 ч');
    expect(legalTermLine(term, new Date(at.getTime() + 26 * 3_600_000))).toContain('Просрочено на 2 ч');
  });
});

describe('production calendar', () => {
  it('knows holidays, the days they moved to and the January decree of 2026', () => {
    expect(isWorkingDay(2026, 11, 4)).toBe(false);
    expect(isWorkingDay(2026, 3, 9)).toBe(false); // 8 March is a Sunday
    expect(isWorkingDay(2026, 5, 11)).toBe(false); // 9 May is a Saturday
    expect(isWorkingDay(2026, 1, 9)).toBe(false);
    expect(isWorkingDay(2026, 12, 31)).toBe(false);
    expect(isWorkingDay(2026, 1, 12)).toBe(true);
    expect(isWorkingDay(2026, 10, 24)).toBe(false); // a Saturday
    expect(isWorkingDay(2026, 10, 26)).toBe(true);
  });
});
