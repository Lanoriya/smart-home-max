import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.js';
import { MaxMessenger } from '../bot/max-client.js';
import { MaxWebhookService } from '../bot/max-webhook-service.js';
import { maxUpdateSchema } from '../bot/max-update.js';

export const maxWebhookRouter = Router();
const webhookService = new MaxWebhookService(new MaxMessenger());

function secretsEqual(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

maxWebhookRouter.post('/', async (request, response, next) => {
  if (!secretsEqual(request.header('x-max-bot-api-secret'), env.MAX_WEBHOOK_SECRET)) {
    response.status(401).json({ code: 'invalid_webhook_secret' });
    return;
  }

  const parsed = maxUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      code: 'invalid_max_update',
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    await webhookService.handle(parsed.data);
    response.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});
