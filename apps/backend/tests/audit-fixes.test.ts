import { describe, expect, it } from 'vitest';
import { apartmentNumberWhere, normalizeApartmentNumber } from '../src/shared/apartment-number.js';
import { lookupPhones } from '../src/residents/vehicle-phones.js';
import { buildingZone, formatInZone } from '../src/shared/time-zone.js';
import { notificationText } from '../src/incidents/admin-incidents.js';
import { photoBytesOf, photoMimeOf } from '../src/photos/storage.js';

describe('apartment numbers', () => {
  it('reads a number with a letter the same way everywhere', () => {
    expect(normalizeApartmentNumber('12а')).toBe('12А');
    expect(normalizeApartmentNumber(' 12 - a ')).toBe('12А');
    expect(normalizeApartmentNumber('45')).toBe('45');
    expect(normalizeApartmentNumber('12/1')).toBeNull();
    expect(normalizeApartmentNumber('кв')).toBeNull();
  });

  it('finds a number stored in a Latin letter too', () => {
    expect(apartmentNumberWhere('12А').OR.map((item) => item.number.equals)).toEqual(['12А', '12A']);
  });
});

describe('phones of a found car', () => {
  const consent = { phoneConsentAt: new Date(), phoneVisibility: 'vehicle_lookup' };
  const car = (patch: Partial<Parameters<typeof lookupPhones>[0]>) => lookupPhones({
    userId: 'adder', owner: null, user: { sharedPhone: '+79001112233' },
    apartment: { profile: consent, memberships: [{ userId: 'adder' }, { userId: 'neighbour' }] },
    ...patch,
  });

  it('shows the phone of the owner written for the car', () => {
    expect(car({ owner: { phones: ['+79005556677'] } })).toEqual(['+7 (900) 555-66-77']);
  });

  it('falls back only to the resident who added the car, never to the others', () => {
    expect(car({})).toEqual(['+7 (900) 111-22-33']);
    expect(car({ apartment: { profile: consent, memberships: [{ userId: 'neighbour' }] } })).toEqual([]);
  });

  it('shows nothing without the consent of the apartment', () => {
    expect(car({ apartment: { profile: { phoneConsentAt: null, phoneVisibility: 'hidden' }, memberships: [{ userId: 'adder' }] } })).toEqual([]);
  });
});

describe('time zones of houses', () => {
  it('takes the zone of the city or of the longitude', () => {
    expect(buildingZone({ city: 'Новосибирск', longitude: null })).toBe('Asia/Novosibirsk');
    expect(buildingZone({ city: null, longitude: 37.6 })).toBe('Europe/Moscow');
  });

  it('writes the deadline of a notification on the clock of the house', () => {
    const dueAt = new Date('2026-10-28T09:00:00Z');
    expect(formatInZone(dueAt, 'Europe/Moscow')).toContain('12:00');
    const text = notificationText({ number: 1, title: 'Лифт', status: 'in_progress', dueAt, delayReason: null, timeZone: 'Asia/Novosibirsk' }).value;
    expect(text).toContain('Плановый срок: 28.10.2026, 16:00');
  });
});

describe('photo files', () => {
  it('decodes a photo of the app and recognises its type', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const bytes = photoBytesOf(`data:image/png;base64,${png.toString('base64')}`);
    expect(bytes && photoMimeOf(bytes)).toBe('image/png');
    expect(photoBytesOf('https://example.org/a.png')).toBeNull();
    expect(photoMimeOf(Buffer.from('not an image'))).toBeNull();
  });
});
