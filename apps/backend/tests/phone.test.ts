import { describe, expect, it } from 'vitest';
import { formatRussianPhone, normalizeRussianPhone } from '../src/shared/phone.js';

describe('Russian phone numbers', () => {
  it.each([
    ['+7 900 123-45-67', '+79001234567'],
    ['8 (3452) 12-34-56', '+73452123456'],
    ['9001234567', '+79001234567'],
    ['+7(495)1234567', '+74951234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeRussianPhone(input)).toBe(expected);
  });

  it.each(['112', '+1 202 555 0100', '8 700 123 45 67', '900-12-34', 'звоните 8 900 123 45 67', ''])('rejects %s', (input) => {
    expect(normalizeRussianPhone(input)).toBeNull();
  });

  it('formats a normalized number for residents', () => {
    expect(formatRussianPhone('+73452123456')).toBe('+7 (345) 212-34-56');
  });
});
