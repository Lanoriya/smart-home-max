import { describe, expect, it } from 'vitest';
import { fitRows } from '../src/bot/max-client.js';

const button = (text: string) => ({ text, payload: text });

describe('keyboard rows', () => {
  it('keeps short buttons side by side', () => {
    expect(fitRows([[button('Мои заявки'), button('Заявки дома')]])).toHaveLength(1);
    expect(fitRows([[button('№ 1'), button('№ 12'), button('№ 105')]])).toHaveLength(1);
  });

  it('puts every button of a row on its own line when a label would be cut', () => {
    expect(fitRows([[button('Написать комментарий'), button('Добавить фото')]])).toEqual([[button('Написать комментарий')], [button('Добавить фото')]]);
  });

  it('never touches a single button', () => {
    expect(fitRows([[button('Выбрать новый дом и квартиру')]])).toHaveLength(1);
  });
});
