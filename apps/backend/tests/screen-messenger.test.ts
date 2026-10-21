import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ user: { findUnique: vi.fn(), updateMany: vi.fn() }, residentMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership' }) } }));
vi.mock('../src/shared/prisma.js', () => ({ prisma: prismaMock }));

const { ScreenMessenger } = await import('../src/bot/screen-messenger.js');

function inner() {
  return {
    sendMessageToUser: vi.fn().mockResolvedValue('new-message'),
    editMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe('one live bot screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ screenMessageId: 'screen-1', screenHasMedia: false });
  });

  it('edits the screen when its own button was pressed', async () => {
    const messenger = inner();
    await new ScreenMessenger(messenger, 'screen-1').sendMessageToUser('42', 'Главное меню');
    expect(messenger.editMessage).toHaveBeenCalledWith('screen-1', 'Главное меню', [[{ text: 'В главное меню', payload: 'menu:main' }]]);
    expect(messenger.sendMessageToUser).not.toHaveBeenCalled();
    expect(messenger.deleteMessage).not.toHaveBeenCalled();
  });

  it('replaces the screen with a new message when the resident types text', async () => {
    const messenger = inner();
    await new ScreenMessenger(messenger).sendMessageToUser('42', 'Описание принято');
    expect(messenger.sendMessageToUser).toHaveBeenCalledOnce();
    expect(messenger.deleteMessage).toHaveBeenCalledWith('screen-1');
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({ where: { maxUserId: '42' }, data: { screenMessageId: 'new-message', screenHasMedia: false } });
  });

  it('does not edit a notification: a button there opens a new screen', async () => {
    const messenger = inner();
    await new ScreenMessenger(messenger, 'notification-7').sendMessageToUser('42', 'Заявка № 3');
    expect(messenger.editMessage).not.toHaveBeenCalled();
    expect(messenger.deleteMessage).toHaveBeenCalledWith('screen-1');
  });

  it('sends a new message for a screen with photos', async () => {
    const messenger = inner();
    await new ScreenMessenger(messenger, 'screen-1').sendMessageToUser('42', 'Заявка № 3', [], [{ token: 't' }]);
    expect(messenger.editMessage).not.toHaveBeenCalled();
    expect(messenger.deleteMessage).toHaveBeenCalledWith('screen-1');
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({ where: { maxUserId: '42' }, data: { screenMessageId: 'new-message', screenHasMedia: true } });
  });

  it('falls back to a new message when MAX refuses the edit', async () => {
    const messenger = inner();
    messenger.editMessage.mockRejectedValue(new Error('message is too old'));
    await new ScreenMessenger(messenger, 'screen-1').sendMessageToUser('42', 'Главное меню');
    expect(messenger.sendMessageToUser).toHaveBeenCalledOnce();
    expect(messenger.deleteMessage).toHaveBeenCalledWith('screen-1');
  });

  it('keeps earlier replies of the same update and makes the last one the screen', async () => {
    const messenger = inner();
    messenger.sendMessageToUser.mockResolvedValueOnce('photos').mockResolvedValueOnce('list');
    const screen = new ScreenMessenger(messenger);
    await screen.sendMessageToUser('42', 'Фото к похожей заявке', [], [{ token: 't' }]);
    await screen.sendMessageToUser('42', 'Нашлись похожие заявки');
    expect(messenger.deleteMessage).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.updateMany).toHaveBeenLastCalledWith({ where: { maxUserId: '42' }, data: { screenMessageId: 'list', screenHasMedia: false } });
  });
});

describe('messages always have a way out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ screenMessageId: null, screenHasMedia: false });
  });

  it('adds a main menu button to a message without buttons', async () => {
    prismaMock.residentMembership.findFirst.mockResolvedValue({ id: 'membership' });
    const messenger = inner();
    await new ScreenMessenger(messenger).sendMessageToUser('42', 'Ошибка');
    expect(messenger.sendMessageToUser).toHaveBeenCalledWith('42', 'Ошибка', [[{ text: 'В главное меню', payload: 'menu:main' }]], []);
  });

});

describe('a failed reply does not pile up messages', () => {
  it('lets the error reply replace the screen after the first send failed', async () => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ screenMessageId: 'screen-1', screenHasMedia: false });
    const messenger = inner();
    messenger.editMessage.mockRejectedValue(new Error('rejected'));
    messenger.sendMessageToUser.mockRejectedValueOnce(new Error('rejected')).mockResolvedValueOnce('error-reply');
    const screen = new ScreenMessenger(messenger, 'screen-1');
    await expect(screen.sendMessageToUser('42', 'Главное меню', [[{ text: 'В главное меню', payload: 'menu:main' }]])).rejects.toThrow();
    await screen.sendMessageToUser('42', 'Диалог устарел', [[{ text: 'В главное меню', payload: 'menu:main' }]]);
    expect(messenger.deleteMessage).toHaveBeenCalledWith('screen-1');
  });
});
