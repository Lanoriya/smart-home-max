import { env } from './config/env.js';
import { logger } from './shared/logger.js';
import { prisma } from './shared/prisma.js';
import { MaxApiError, MaxMessenger } from './bot/max-client.js';
import { MaxWebhookService } from './bot/max-webhook-service.js';
import type { CallbackButton } from './bot/messenger.js';
import { Html } from './shared/html.js';
import { remindLegalTerms } from './incidents/legal-reminders.js';
import { moveLegacyPhotos } from './photos/storage.js';

const messenger = new MaxMessenger();
const maxWebhookService = new MaxWebhookService(messenger);
let running = true;
let nextCleanupAt = 0;
let nextRemindersAt = 0;

type NotificationPayload = {
  userId: string;
  text: string;
  // 'html' marks text that was built with the html template and is already
  // escaped. Any other text is plain and is escaped on sending.
  format?: 'html';
  buttons?: CallbackButton[][];
};

const deliveryWindowMs = 24 * 60 * 60 * 1000;

// 10 s, 20 s, 40 s … doubling up to 30 minutes between attempts.
function retryDelayMs(attempts: number) {
  return Math.min(30 * 60 * 1000, 2 ** Math.min(attempts, 20) * 5_000);
}

async function processBatch() {
  if (Date.now() >= nextCleanupAt) {
    const now = new Date();
    await prisma.$transaction([
      prisma.processedUpdate.deleteMany({ where: { processedAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } } }),
      prisma.outboxMessage.deleteMany({ where: { status: 'delivered', deliveredAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } }),
      prisma.botSession.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.adminSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    nextCleanupAt = Date.now() + 24 * 60 * 60 * 1000;
  }
  if (Date.now() >= nextRemindersAt) {
    nextRemindersAt = Date.now() + 5 * 60 * 1000;
    const sent = await remindLegalTerms();
    if (sent) logger.info({ sent }, 'Legal term reminders queued');
  }
  // A process can be stopped after claiming a message but before delivery.
  // Reclaim only sufficiently old records so an actively sending worker is not interrupted.
  await prisma.outboxMessage.updateMany({
    where: { status: 'processing', nextAttemptAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
    data: { status: 'pending', nextAttemptAt: new Date(), lastError: 'Delivery was interrupted; retrying.' },
  });
  const messages = await prisma.outboxMessage.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });

  for (const message of messages) {
    const claimed = await prisma.outboxMessage.updateMany({
      where: { id: message.id, status: 'pending' },
      data: { status: 'processing', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000) },
    });
    if (claimed.count === 0) continue;

    try {
      const payload = message.payload as NotificationPayload;
      await messenger.sendMessageToUser(payload.userId, payload.format === 'html' ? new Html(payload.text) : payload.text, payload.buttons);
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: { status: 'delivered', deliveredAt: new Date(), lastError: null },
      });
    } catch (error) {
      const attempts = message.attempts + 1;
      // A short outage of MAX must not lose notifications: the message is
      // retried with a growing pause (up to 30 minutes) for a day. Only an
      // answer that will never change (the user blocked the bot, no such
      // chat, a malformed message) ends the attempts at once.
      const permanent = error instanceof MaxApiError && [400, 403, 404].includes(error.status);
      const isDead = permanent || Date.now() - message.createdAt.getTime() >= deliveryWindowMs;
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: isDead ? 'dead' : 'pending',
          lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error',
          nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
        },
      });
    }
  }
}

async function notificationLoop() {
  while (running) {
    await processBatch().catch((error) => logger.error({ error }, 'Worker batch failed'));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function maxPollingLoop() {
  if (env.MAX_MODE !== 'api' || env.MAX_RECEIVE_MODE !== 'polling') return;

  let marker: string | undefined;
  logger.info('MAX long polling started');
  while (running) {
    try {
      const page = await messenger.getUpdates(marker);
      // Advance the marker even if handling fails (for example, the database is
      // briefly unavailable): otherwise the same page would be fetched forever.
      if (page.marker) marker = page.marker;
      for (const update of page.updates) {
        await maxWebhookService.handle(update).catch((error: unknown) => logger.error({ error }, 'MAX update failed'));
      }
    } catch (error) {
      logger.error({ error }, 'MAX long polling failed');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function main() {
  logger.info(
    { maxMode: env.MAX_MODE, maxReceiveMode: env.MAX_RECEIVE_MODE },
    'Worker started',
  );
  // Old photos kept as base64 in the database are moved to files once.
  void moveLegacyPhotos().catch((error: unknown) => logger.error({ error }, 'Moving photos to files failed'));
  await Promise.all([notificationLoop(), maxPollingLoop()]);
  await prisma.$disconnect();
}

process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

void main();
