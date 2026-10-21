import { describe, expect, it } from 'vitest';
import { houseKey, parseRegistryAddress, streetKey } from '../src/registry/address.js';

describe('matching addresses of the map and of the registry', () => {
  it('drops street types in any position and form', () => {
    expect(streetKey('ул. Викулова')).toBe('викулова');
    expect(streetKey('улица Викулова')).toBe('викулова');
    expect(streetKey('проспект Ленина')).toBe('ленина');
    expect(streetKey('пр-кт Ленина')).toBe('ленина');
    expect(streetKey('Шадринский переулок')).toBe('шадринский');
    expect(streetKey('ул. Бакинских комиссаров')).toBe('бакинских комиссаров');
    expect(streetKey('улица 8 Марта')).toBe('8 марта');
    expect(streetKey('Ёлочная улица')).toBe('елочная');
  });

  it('brings house numbers with letters, corpuses and buildings to one form', () => {
    expect(houseKey('д. 48')).toBe('48');
    expect(houseKey('48')).toBe('48');
    expect(houseKey('д. 1А')).toBe('1а');
    expect(houseKey('1а')).toBe('1а');
    expect(houseKey('д. 14КОРПУС 2')).toBe('14к2');
    expect(houseKey('14к2')).toBe('14к2');
    expect(houseKey('14 к2')).toBe('14к2');
    expect(houseKey('14 корп. 2')).toBe('14к2');
    expect(houseKey('20 стр. 1')).toBe('20с1');
  });

  it('reads the locality, street and house of a registry address', () => {
    expect(parseRegistryAddress('г. Екатеринбург, ул. Викулова, д. 48')).toEqual({ locality: 'екатеринбург', street: 'ул. Викулова', house: 'д. 48' });
    expect(parseRegistryAddress('пос. Мичуринский (г Екатеринбург), ул. Карасьевская, д. 16')?.locality).toBe('мичуринский');
    expect(parseRegistryAddress('Арамильский городской округ Свердловской области, пос. Арамиль, ул. Заводская, д. 22')).toEqual({ locality: 'арамиль', street: 'ул. Заводская', house: 'д. 22' });
    expect(parseRegistryAddress('г. Екатеринбург, пер. Шадринский, д. 14КОРПУС 2')?.house).toBe('д. 14КОРПУС 2');
    expect(parseRegistryAddress('без дома')).toBeNull();
  });
});
