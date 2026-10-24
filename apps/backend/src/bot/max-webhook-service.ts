import type { Messenger } from './messenger.js';
import { getMaxContact, getMaxImages, getMaxUpdateKey, getMaxUserId, getMaxUserName, getMaxUsername, type MaxUpdate } from './max-update.js';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';
import { IncidentFlow } from './incident-flow.js';
import { ScreenMessenger } from './screen-messenger.js';
import { houseFromStartPayload } from '../buildings/house-link.js';

export class MaxWebhookService {
  constructor(private readonly messenger: Messenger) {}

  async handle(update: MaxUpdate): Promise<void> {
    const updateKey = getMaxUpdateKey(update);
    const inserted = await prisma.processedUpdate.createMany({
      data: [{ id: updateKey, updateType: update.update_type }],
      skipDuplicates: true,
    });

    if (inserted.count === 0) {
      logger.info({ updateKey }, 'Duplicate MAX update ignored');
      return;
    }

    // Keep the MAX profile name up to date: residents see it in join requests.
    const maxUserId = getMaxUserId(update);
    const name = getMaxUserName(update);
    const username = getMaxUsername(update);
    if (maxUserId && (name || username)) {
      const profile = { ...(name ? { displayName: name } : {}), ...(username ? { maxUsername: username } : {}) };
      await prisma.user.upsert({ where: { maxUserId }, update: profile, create: { maxUserId, ...profile } }).catch((error: unknown) => logger.warn({ error }, 'Failed to store MAX user profile'));
    }

    // Each update gets its own screen: a pressed button edits the message it
    // belongs to instead of adding a new one.
    const sourceMessageId = update.update_type === 'message_callback' ? update.message?.body?.mid : undefined;
    const incidentFlow = new IncidentFlow(new ScreenMessenger(this.messenger, sourceMessageId));
    try {
      await this.processUpdate(update, incidentFlow);
    } catch (error) {
      // A failing update is not retried: in long polling a retry would block every
      // later update forever, and a webhook redelivery would fail the same way.
      // The resident gets a neutral reply and the error stays in the log.
      logger.error({ error, updateKey, updateType: update.update_type }, 'MAX update processing failed');
      const userId = getMaxUserId(update);
      if (userId) {
        await incidentFlow.sendStaleDialog(userId).catch((replyError: unknown) => {
          logger.warn({ error: replyError, updateKey }, 'MAX fallback reply failed');
        });
      }
    }
  }

  private async processUpdate(update: MaxUpdate, incidentFlow: IncidentFlow): Promise<void> {
    const userId = getMaxUserId(update);
    if (!userId) {
      logger.warn({ updateType: update.update_type }, 'MAX update has no user id');
      return;
    }

    if (update.update_type === 'bot_started') {
      // A link https://max.ru/<bot>?start=invite_… invites a company employee.
      const startPayload = typeof update.payload === 'string' ? update.payload : null;
      if (startPayload?.startsWith('invite_') && /^invite_[A-Za-z0-9_-]{10,200}$/.test(startPayload)) {
        await this.messenger.sendMessageToUser(userId, 'Вас пригласили в команду управляющей компании в сервисе «Домовед». Откройте приложение, чтобы принять приглашение.', [
          [{ text: 'Принять приглашение', payload: startPayload, openApp: true }],
          [{ text: 'В главное меню', payload: 'menu:main' }],
        ]);
        return;
      }
      // https://max.ru/<bot>?start=house_<id> — the QR code at the entrance.
      const houseId = houseFromStartPayload(startPayload);
      if (houseId) {
        await incidentFlow.startAtHouse(userId, houseId);
        return;
      }
      await incidentFlow.start(userId);
      return;
    }

    if (update.update_type === 'message_created') {
      const contact = getMaxContact(update);
      if (contact) {
        await incidentFlow.handleContact(userId, contact);
        return;
      }
      const rawText = update.message?.body?.text?.trim();
      const images = getMaxImages(update);
      const text = rawText?.toLowerCase();
      // Any command ("/start", a mistyped "/startt", "/menu") and the words
      // "начать" or "меню" open the main menu; a command is never saved as a
      // comment or a description in the middle of a dialog.
      if (text?.startsWith('/') || text === 'начать' || text === 'меню' || text === 'главное меню') {
        await incidentFlow.start(userId);
      } else if (rawText || images.length) {
        const handled = await incidentFlow.handleText(userId, rawText ?? '', images);
        if (!handled) await incidentFlow.start(userId);
      }
      return;
    }

    if (update.update_type === 'message_callback') {
      // The callback is not acknowledged through /answers: an answer with a
      // message replaces the pressed message with that text ("Принято"), and
      // every button already gets a full reply from the bot.
      const payload = update.callback?.payload;
      if (payload) await incidentFlow.handleCallback(userId, payload);
    }
  }
}
