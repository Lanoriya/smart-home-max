import { describe, expect, it } from 'vitest';
import { localTime, offsetLabel, zoneOf } from '../src/shared/time-zone.js';

describe('local time of a company', () => {
  it('knows the cities of the demo by name', () => {
    expect(zoneOf('Екатеринбург', null)).toBe('Asia/Yekaterinburg');
    expect(zoneOf('Казань', null)).toBe('Europe/Moscow');
    expect(zoneOf('Новосибирск', null)).toBe('Asia/Novosibirsk');
    expect(zoneOf('Пермь', null)).toBe('Asia/Yekaterinburg');
  });

  it('takes the zone by the longitude of an unknown town', () => {
    expect(zoneOf('Берёзовский', 60.8)).toBe('Asia/Yekaterinburg');
    expect(zoneOf(null, 37.6)).toBe('Europe/Moscow');
    expect(zoneOf(null, 131.9)).toBe('Asia/Vladivostok');
    expect(zoneOf(null, null)).toBe('Europe/Moscow');
  });

  it('signs the time as local with its offset', () => {
    const at = new Date('2026-10-23T12:34:00Z');
    expect(offsetLabel(at, 'Asia/Yekaterinburg')).toBe('UTC+5');
    expect(localTime(at, 'Asia/Yekaterinburg')).toContain('17:34 по местному времени (UTC+5)');
  });
});
