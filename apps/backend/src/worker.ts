import { env } from './config/env.js';
import { logger } from './shared/logger.js';
import { prisma } from './shared/prisma.js';
import { MaxMessenger } from './bot/max-client.js';
import { MaxWebhookService } from './bot/max-webhook-service.js';
import type { CallbackButton } from './bot/messenger.js';

const messenger = new MaxMessenger();
const maxWebhookService = new MaxWebhookService(messenger);
let running = true;
let nextCleanupAt = 0;

type NotificationPayload = {
  userId: string;
  text: string;
  buttons?: CallbackButton[][];
};

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
      await messenger.sendMessageToUser(payload.userId, payload.text, payload.buttons);
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: { status: 'delivered', deliveredAt: new Date(), lastError: null },
      });
    } catch (error) {
      const attempts = message.attempts + 1;
      const isDead = attempts >= 5;
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: isDead ? 'dead' : 'pending',
          lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error',
          nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1000)),
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
      for (const update of page.updates) {
        await maxWebhookService.handle(update);
      }
      if (page.marker) marker = page.marker;
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
  await Promise.all([notificationLoop(), maxPollingLoop()]);
  await prisma.$disconnect();
}

process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

void main();
