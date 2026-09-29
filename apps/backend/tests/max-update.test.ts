import { describe, expect, it } from 'vitest';
import { getMaxUpdateKey, getMaxUserId, maxUpdateSchema } from '../src/bot/max-update.js';

describe('MAX update parsing', () => {
  it('reads the sender from a message_created update', () => {
    const update = maxUpdateSchema.parse({
      update_type: 'message_created',
      timestamp: 1_700_000_000_000,
      message: {
        sender: { user_id: 42 },
        body: { mid: 'message-1', text: '/start' },
      },
    });

    expect(getMaxUserId(update)).toBe('42');
    expect(getMaxUpdateKey(update)).toBe('message_created:1700000000000:message-1');
  });
});
