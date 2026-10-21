import { describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  processedUpdate: { createMany: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('../src/shared/prisma.js', () => ({ prisma: prismaMock }));

const { MaxWebhookService } = await import('../src/bot/max-webhook-service.js');

describe('MAX update handling', () => {
  it('answers the resident and does not rethrow when an update fails', async () => {
    prismaMock.processedUpdate.createMany.mockResolvedValue({ count: 1 });
    // The flow fails on its first database read; the fallback reply then works.
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error('broken session')).mockResolvedValue(null);
    const messenger = { sendMessageToUser: vi.fn().mockResolvedValue('message-1') };
    const service = new MaxWebhookService(messenger);

    await expect(service.handle({
      update_type: 'message_callback',
      timestamp: 1_700_000_000_000,
      callback: { callback_id: 'callback-1', payload: 'incident:submit', user: { user_id: 42 } },
    })).resolves.toBeUndefined();

    // The update stays marked as processed, so long polling cannot loop on it.
    expect(prismaMock.processedUpdate.deleteMany).not.toHaveBeenCalled();
    expect(messenger.sendMessageToUser).toHaveBeenCalledWith('42', 'Диалог устарел. Выберите действие в главном меню.', expect.any(Array), []);
  });
});
