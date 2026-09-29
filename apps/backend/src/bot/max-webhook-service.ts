import type { Messenger } from './messenger.js';
import { getMaxImages, getMaxUpdateKey, getMaxUserId, type MaxUpdate } from './max-update.js';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';
import { IncidentFlow } from './incident-flow.js';

export class MaxWebhookService {
  private readonly incidentFlow: IncidentFlow;

  constructor(private readonly messenger: Messenger) {
    this.incidentFlow = new IncidentFlow(messenger);
  }

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

    try {
      await this.processUpdate(update);
    } catch (error) {
      // A failed update must remain retryable when MAX redelivers it.
      await prisma.processedUpdate.deleteMany({ where: { id: updateKey } });
      throw error;
    }
  }

  private async processUpdate(update: MaxUpdate): Promise<void> {
    const userId = getMaxUserId(update);
    if (!userId) {
      logger.warn({ updateType: update.update_type }, 'MAX update has no user id');
      return;
    }

    if (update.update_type === 'bot_started') {
      await this.incidentFlow.start(userId);
      return;
    }

    if (update.update_type === 'message_created') {
      const rawText = update.message?.body?.text?.trim();
      const images = getMaxImages(update);
      const text = rawText?.toLowerCase();
      if (text === '/start' || text === 'начать') {
        await this.incidentFlow.start(userId);
      } else if (rawText || images.length) {
        const handled = await this.incidentFlow.handleText(userId, rawText ?? '', images);
        if (!handled) await this.incidentFlow.start(userId);
      }
      return;
    }

    if (update.update_type === 'message_callback') {
      const payload = update.callback?.payload;
      if (update.callback?.callback_id) {
        try {
          await this.messenger.answerCallback?.(update.callback.callback_id);
        } catch (error) {
          // Callback acknowledgement is cosmetic and must not block the business flow.
          logger.warn({ error }, 'MAX callback acknowledgement failed');
        }
      }
      if (payload) await this.incidentFlow.handleCallback(userId, payload);
    }
  }

}
