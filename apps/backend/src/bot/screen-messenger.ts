import { resolveAppButtons } from './app-buttons.js';
import type { CallbackButton, ImageAttachment, Messenger } from './messenger.js';
import type { Html } from '../shared/html.js';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';

// Keeps one live bot screen per resident while one update is handled.
//
// The first reply to an update replaces the resident's current screen:
// - a button pressed on that screen edits the same message in place;
// - otherwise (typed text, a button in a notification, a screen with photos,
//   or an edit that MAX refused) a new message is sent and the old screen is
//   deleted.
// Further replies to the same update are sent as new messages, and the last
// one becomes the screen. Notifications sent by the worker never become a
// screen, so they are neither edited nor deleted.
export class ScreenMessenger implements Messenger {
  private replied = false;

  constructor(
    private readonly inner: Messenger,
    private readonly sourceMessageId?: string,
  ) {}

  async sendMessageToUser(maxUserId: string, text: string | Html, rawButtons: CallbackButton[][] = [], images: ImageAttachment[] = []): Promise<string | null> {
    const hasMedia = images.length > 0;
    // A resident must never be left without a way out: a message without
    // buttons (an error, a prompt) gets one. Photo-only messages are skipped,
    // the screen with the buttons follows them.
    // App buttons become personal links here, before a screen is edited in place.
    const buttons = resolveAppButtons(rawButtons.length || hasMedia ? rawButtons : await this.exitButtons(maxUserId), maxUserId);
    if (this.replied) {
      const messageId = await this.inner.sendMessageToUser(maxUserId, text, buttons, images);
      await this.remember(maxUserId, messageId, hasMedia);
      return messageId;
    }
    const user = await prisma.user.findUnique({ where: { maxUserId }, select: { screenMessageId: true, screenHasMedia: true } });
    const screen = user?.screenMessageId ?? null;
    const canEdit = Boolean(screen && this.sourceMessageId === screen && !hasMedia && !user?.screenHasMedia && this.inner.editMessage);
    if (canEdit && screen) {
      try {
        await this.inner.editMessage!(screen, text, buttons);
        this.replied = true;
        return screen;
      } catch (error) {
        // For example the message is too old to edit: fall back to a new one.
        logger.warn({ error }, 'MAX screen edit failed, sending a new message');
      }
    }

    const messageId = await this.inner.sendMessageToUser(maxUserId, text, buttons, images);
    // Marked only after a successful send: if this reply fails, the error
    // reply that follows still replaces the screen instead of piling up.
    this.replied = true;
    if (screen && screen !== messageId) {
      await this.inner.deleteMessage?.(screen).catch((error: unknown) => logger.warn({ error }, 'MAX screen delete failed'));
    }
    await this.remember(maxUserId, messageId, hasMedia);
    return messageId;
  }

  // The main menu of a resident without an apartment is the waiting screen or
  // choosing a building, so one button fits everyone.
  private async exitButtons(_maxUserId: string): Promise<CallbackButton[][]> {
    return [[{ text: 'В главное меню', payload: 'menu:main' }]];
  }

  private async remember(maxUserId: string, messageId: string | null, hasMedia: boolean) {
    if (!messageId) return;
    await prisma.user.updateMany({ where: { maxUserId }, data: { screenMessageId: messageId, screenHasMedia: hasMedia } });
  }
}
