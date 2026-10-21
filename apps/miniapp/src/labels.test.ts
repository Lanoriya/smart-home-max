import { describe, expect, it } from 'vitest';
import { duration, percent, place, plural, addressLines } from './labels';

describe('texts of the mini-app', () => {
  it('declines Russian nouns by number', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 112].map((count) => plural(count, 'житель', 'жителя', 'жителей')))
      .toEqual(['житель', 'жителя', 'жителей', 'жителей', 'житель', 'жителя', 'жителей', 'жителей']);
  });

  it('names the place of an incident', () => {
    expect(place({ locationZone: 'elevator', entranceNumber: 2 })).toBe('Лифт, подъезд 2');
    expect(place({ locationZone: 'entrance', entranceNumber: 5 })).toBe('Подъезд 5');
    expect(place({ locationZone: 'yard', entranceNumber: null })).toBe('Двор');
    expect(place({ locationZone: 'apartment', entranceNumber: null, apartmentNumber: '45' })).toBe('Квартира 45');
  });

  it('formats the metrics of the desk', () => {
    expect(duration(null)).toBe('—');
    expect(duration(42)).toBe('42 мин');
    expect(duration(90)).toBe('1.5 ч');
    expect(duration(60 * 72)).toBe('3 дн');
    expect(percent(0.666)).toBe('67%');
    expect(percent(null)).toBe('—');
  });
});

describe('addressLines', () => {
  it('keeps a plain number', () => {
    expect(addressLines('улица Ленина', '3', '15')).toEqual({ main: 'улица Ленина, 3', details: ['Квартира: 15'] });
  });
  it('moves the corpus and the building to their own lines', () => {
    expect(addressLines('улица Мира', '7, корп. 1').details).toEqual(['Корпус: 1']);
    expect(addressLines('Чистопольская улица', '61А к2')).toEqual({ main: 'Чистопольская улица, 61А', details: ['Корпус: 2'] });
    expect(addressLines('улица Луговая', '7 стр. 1')).toEqual({ main: 'улица Луговая, 7', details: ['Строение: 1'] });
  });
  it('does not take a letter of the number for a corpus', () => {
    expect(addressLines('улица 8 Марта', '204Е').main).toBe('улица 8 Марта, 204Е');
    expect(addressLines('улица 22-го Партсъезда', '3/2').main).toBe('улица 22-го Партсъезда, 3/2');
  });
});
