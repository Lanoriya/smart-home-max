import { describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  processedUpdate: { createMany: vi.fn() },
  user: { upsert: vi.fn() },
}));
const flow = vi.hoisted(() => ({ handleCallback: vi.fn(), sendStaleDialog: vi.fn() }));
vi.mock('../src/shared/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/bot/incident-flow.js', () => ({ IncidentFlow: vi.fn(() => flow) }));

const { MaxWebhookService } = await import('../src/bot/max-webhook-service.js');
const { contractKey } = await import('../src/shared/contract.js');

describe('a button the bot does not know', () => {
  it('gets the stale dialog instead of silence', async () => {
    prismaMock.processedUpdate.createMany.mockResolvedValue({ count: 1 });
    flow.handleCallback.mockResolvedValue(false);
    await new MaxWebhookService({ sendMessageToUser: vi.fn() }).handle({
      update_type: 'message_callback', timestamp: 1, callback: { callback_id: 'c', payload: 'building:choose:gone', user: { user_id: 7 } },
    });
    expect(flow.sendStaleDialog).toHaveBeenCalledWith('7');
  });

  it('is not answered twice when it was handled', async () => {
    prismaMock.processedUpdate.createMany.mockResolvedValue({ count: 1 });
    flow.handleCallback.mockResolvedValue(true);
    flow.sendStaleDialog.mockClear();
    await new MaxWebhookService({ sendMessageToUser: vi.fn() }).handle({
      update_type: 'message_callback', timestamp: 2, callback: { callback_id: 'd', payload: 'menu:main', user: { user_id: 7 } },
    });
    expect(flow.sendStaleDialog).not.toHaveBeenCalled();
  });
});

describe('contract numbers', () => {
  it('match whatever the case, spaces and look-alike letters', () => {
    expect(contractKey('ДУ-6/2024')).toBe(contractKey('ду 6/2024'));
    expect(contractKey('QA-10-2024')).toBe(contractKey('qa 10 2024'));
    // A Latin "A" typed for the Cyrillic one.
    expect(contractKey('А-123')).toBe(contractKey('a123'));
    expect(contractKey('1234')).not.toBe(contractKey('1235'));
  });
});
