import { describe, expect, it } from 'vitest';
import { addressMatches, compareBuildings, composeAddress } from '../src/buildings/address.js';

describe('building addresses', () => {
  it('joins street and house for display', () => {
    expect(composeAddress('ул. Ленина', '10, корп. 2')).toBe('ул. Ленина, 10, корп. 2');
    expect(composeAddress('Тестовый переулок', '')).toBe('Тестовый переулок');
  });

  it('sorts streets alphabetically and houses by number', () => {
    const houses = ['10', '2', '12а', '1', '12'].map((house) => ({ street: 'ул. Ленина', house }));
    const streets = [{ street: 'ул. Мира', house: '1' }, { street: 'ул. Ленина', house: '3' }];
    expect([...houses].sort(compareBuildings).map((item) => item.house)).toEqual(['1', '2', '10', '12', '12а']);
    expect([...streets].sort(compareBuildings).map((item) => item.street)).toEqual(['ул. Ленина', 'ул. Мира']);
  });
});

describe('address search', () => {
  const address = 'ул. Тестовая Садовая, 7, корп. 1';
  it.each(['садовая 7', 'Садовая ул. 7 к1', 'тестовая садовая', 'сад 7 1', '7 садовая'])('finds the building by "%s"', (query) => {
    expect(addressMatches(address, query)).toBe(true);
  });
  it.each(['садовая 70', 'мира', 'ул.', ''])('does not find it by "%s"', (query) => {
    expect(addressMatches(address, query)).toBe(false);
  });
  it('splits numbers glued to words and treats ё as е', () => {
    expect(addressMatches('пр. Тестовый Мира, 12', 'мира12')).toBe(true);
    expect(addressMatches('ул. Тестовая Соловьёва, 3', 'соловьева 3')).toBe(true);
  });
});
