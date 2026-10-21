import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from '../src/miniapp/init-data.js';

const token = 'test-bot-token';
const now = Date.UTC(2026, 9, 21, 12, 0, 0);

function launchData(params: Record<string, string>, botToken = token) {
  return new URLSearchParams({ ...params, hash: signInitData(params, botToken) }).toString();
}

const base = {
  auth_date: String(now / 1000 - 60),
  query_id: '4c0ab423-342b-4e45-aea4-2747dbc500cd',
  user: JSON.stringify({ id: 67890, first_name: 'Max', last_name: 'User', username: null, language_code: 'ru' }),
  start_param: 'incident_42',
};

describe('MAX mini-app launch data', () => {
  it('accepts data signed with the bot token and reads the user', () => {
    const result = verifyInitData(launchData(base), token, { now });
    expect(result).toEqual({ ok: true, data: { user: { maxUserId: '67890', displayName: 'Max User', username: null }, authDate: new Date(Number(base.auth_date) * 1000), startParam: 'incident_42' } });
  });

  it('refuses data signed by another bot', () => {
    expect(verifyInitData(launchData(base, 'another-token'), token, { now })).toEqual({ ok: false, error: 'bad_signature' });
  });

  it('refuses data with a changed user', () => {
    const forged = launchData(base).replace('67890', '11111');
    expect(verifyInitData(forged, token, { now })).toEqual({ ok: false, error: 'bad_signature' });
  });

  it('refuses old launch data', () => {
    expect(verifyInitData(launchData({ ...base, auth_date: String(now / 1000 - 2 * 24 * 60 * 60) }), token, { now })).toEqual({ ok: false, error: 'expired' });
  });

  it('refuses data without a hash or with a repeated parameter', () => {
    expect(verifyInitData(new URLSearchParams(base).toString(), token, { now })).toEqual({ ok: false, error: 'missing_hash' });
    expect(verifyInitData(`${launchData(base)}&user=${encodeURIComponent('{"id":1}')}`, token, { now })).toEqual({ ok: false, error: 'malformed' });
  });
});
