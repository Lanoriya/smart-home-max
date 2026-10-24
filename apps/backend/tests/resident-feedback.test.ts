import { describe, expect, it } from 'vitest';
import { acceptanceOf, feedbackOpen, feedbackSchema, feedbackSummary, feedbackWindowDays } from '../src/incidents/resident-feedback.js';
import { feedbackButtons, notificationText } from '../src/incidents/admin-incidents.js';
import { houseFromStartPayload, houseLink, houseQrImageUrl, houseQrPng } from '../src/buildings/house-link.js';
import { signFor } from '../src/bot/button-emoji.js';

const day = 24 * 60 * 60 * 1000;

describe('resident feedback after "resolved"', () => {
  it('is open only for a resolved incident within the window', () => {
    const now = Date.now();
    expect(feedbackOpen({ id: 'a', status: 'resolved', resolvedAt: new Date(now - day) }, now)).toBe(true);
    expect(feedbackOpen({ id: 'a', status: 'resolved', resolvedAt: new Date(now - (feedbackWindowDays + 1) * day) }, now)).toBe(false);
    expect(feedbackOpen({ id: 'a', status: 'in_progress', resolvedAt: null }, now)).toBe(false);
    expect(feedbackOpen({ id: 'a', status: 'rejected', resolvedAt: new Date(now) }, now)).toBe(false);
  });

  it('accepts a rating only from 1 to 5', () => {
    expect(feedbackSchema.safeParse({ resolved: true, rating: 5 }).success).toBe(true);
    expect(feedbackSchema.safeParse({ resolved: true, rating: 0 }).success).toBe(false);
    expect(feedbackSchema.safeParse({ resolved: true, rating: 6 }).success).toBe(false);
    expect(feedbackSchema.safeParse({ resolved: false, comment: 'снова холодно' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ resolved: false, comment: 'а'.repeat(501) }).success).toBe(false);
  });

  it('summarises answers for the desk', () => {
    expect(feedbackSummary([{ resolved: true, rating: 5 }, { resolved: true, rating: 4 }, { resolved: true, rating: null }, { resolved: false, rating: null }]))
      .toEqual({ confirmed: 3, returned: 1, ratingAverage: 4.5 });
    expect(feedbackSummary([])).toEqual({ confirmed: 0, returned: 0, ratingAverage: null });
  });

  it('counts silence after the window as acceptance', () => {
    const now = Date.now();
    const resolvedAt = new Date(now - (feedbackWindowDays + 1) * day);
    expect(acceptanceOf({ status: 'resolved', resolvedAt }, [], now)?.state).toBe('silent');
    expect(acceptanceOf({ status: 'resolved', resolvedAt: new Date(now - day) }, [], now)?.state).toBe('waiting');
    expect(acceptanceOf({ status: 'resolved', resolvedAt: new Date(now - day) }, [{ resolved: true, updatedAt: new Date(now) }], now)?.state).toBe('confirmed');
    // A "yes" given before the latest "resolved" belongs to the previous round.
    expect(acceptanceOf({ status: 'resolved', resolvedAt }, [{ resolved: true, updatedAt: new Date(resolvedAt.getTime() - day) }], now)?.state).toBe('silent');
    expect(acceptanceOf({ status: 'in_progress', resolvedAt: null }, [], now)).toBeNull();
  });

  it('asks the resident in the "resolved" notification', () => {
    const text = notificationText({ number: 7, title: 'Нет воды', status: 'resolved', previousStatus: 'in_progress', dueAt: null, delayReason: null, askFeedback: true }).value;
    expect(text).toContain('Проблема действительно решена?');
    const [row] = feedbackButtons('11111111-1111-1111-1111-111111111111');
    expect(row!.map((button) => button.payload)).toEqual(['incident:accept:11111111-1111-1111-1111-111111111111', 'incident:reopen:11111111-1111-1111-1111-111111111111']);
    expect(signFor(row![0]!)).toBe('✅');
    expect(signFor(row![1]!)).toBe('↩️');
  });
});

describe('the QR code of a house', () => {
  const id = '0f8c2b1e-3a4d-4c5e-8f9a-1b2c3d4e5f60';

  it('opens the bot with the house chosen', () => {
    expect(houseLink(id, 'demo_bot')).toBe(`https://max.ru/demo_bot?start=house_${id}`);
    expect(houseLink(id, '')).toBeNull();
  });

  it('reads only a well-formed house payload', () => {
    expect(houseFromStartPayload(`house_${id}`)).toBe(id);
    expect(houseFromStartPayload('house_123')).toBeNull();
    expect(houseFromStartPayload(`invite_${id}`)).toBeNull();
    expect(houseFromStartPayload(null)).toBeNull();
  });

  it('has a picture the bot can send by its address', async () => {
    expect(houseQrImageUrl(id, 'https://example.ru/app/')).toBe(`https://example.ru/api/qr/house/${id}.png`);
    expect(houseQrImageUrl(id, '')).toBeNull();
    const png = await houseQrPng(houseLink(id, 'demo_bot')!);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(1000);
  });
});
