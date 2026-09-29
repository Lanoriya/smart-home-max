import { describe, expect, it } from 'vitest';
import { hashInviteCode, inviteCodeMatches, normalizeInviteCode } from '../src/users/invite-code.js';

describe('apartment invite codes', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeInviteCode(' smart- 45 ')).toBe('SMART-45');
  });

  it('matches only the correct code and pepper', () => {
    const hash = hashInviteCode('SMART-45', 'test-pepper-value');
    expect(inviteCodeMatches(' smart-45 ', hash, 'test-pepper-value')).toBe(true);
    expect(inviteCodeMatches('SMART-46', hash, 'test-pepper-value')).toBe(false);
  });
});
