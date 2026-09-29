import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { rootCertificates } from 'node:tls';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import type { CallbackButton, ImageAttachment, Messenger } from './messenger.js';
import { maxUpdateSchema, type MaxUpdate } from './max-update.js';
import { z } from 'zod';

type MaxRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
};

const maxUpdatesResponseSchema = z.object({
  updates: z.array(maxUpdateSchema),
  marker: z.union([z.number(), z.string()]).nullish(),
});

export type MaxUpdatesPage = {
  updates: MaxUpdate[];
  marker: string | null;
};

const russianTrustedRootCa = readFileSync(
  new URL('../../certs/russian-trusted-root-ca.crt', import.meta.url),
  'utf8',
);

function requestMaxApi(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (url.protocol !== 'https:') {
    throw new Error('MAX API base URL must use HTTPS');
  }

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method,
        headers,
        // Trust is extended only for this MAX request, not process-wide.
        ca: [...rootCertificates, russianTrustedRootCa],
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let responseBody: unknown = null;
          try {
            responseBody = raw ? JSON.parse(raw) : null;
          } catch {
            responseBody = raw;
          }
          const status = response.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, body: responseBody });
        });
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error('MAX API request timed out')));
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

export class MaxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
  }
}

export class MaxMessenger implements Messenger {
  async sendMessageToUser(
    userId: string,
    text: string,
    buttons: CallbackButton[][] = [],
    images: ImageAttachment[] = [],
  ): Promise<void> {
    if (env.MAX_MODE === 'fake') {
      logger.info({ userId, text, buttons }, 'Fake MAX message');
      return;
    }

    const attachments = [
      ...images.map((image) => ({ type: 'image', payload: image.token ? { token: image.token } : { url: image.url } })),
      ...(buttons.length
      ? [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: buttons.map((row) =>
                row.map((button) => ({
                  type: 'callback',
                  text: button.text,
                  payload: button.payload,
                  ...(button.intent ? { intent: button.intent } : {}),
                })),
              ),
            },
          },
        ]
      : []),
    ];

    await this.request(`/messages?user_id=${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: { text, ...(attachments.length ? { attachments } : {}) },
    });
  }

  async getMe(): Promise<unknown> {
    return this.request('/me');
  }

  async answerCallback(callbackId: string): Promise<void> {
    if (env.MAX_MODE === 'fake') {
      logger.info({ callbackId }, 'Fake MAX callback answer');
      return;
    }
    await this.request(`/answers?callback_id=${encodeURIComponent(callbackId)}`, {
      method: 'POST',
      body: { message: { text: 'Принято' } },
    });
  }

  async getUpdates(marker?: string): Promise<MaxUpdatesPage> {
    const search = new URLSearchParams({
      limit: '100',
      timeout: '30',
      types: 'bot_started,message_created,message_callback',
    });
    if (marker) search.set('marker', marker);

    const parsed = maxUpdatesResponseSchema.parse(
      await this.request(`/updates?${search.toString()}`, { timeoutMs: 40_000 }),
    );
    return {
      updates: parsed.updates,
      marker: parsed.marker == null ? null : String(parsed.marker),
    };
  }

  async getWebhookSubscriptions(): Promise<unknown> {
    return this.request('/subscriptions');
  }

  async createWebhookSubscription(url: string, secret: string): Promise<unknown> {
    return this.request('/subscriptions', {
      method: 'POST',
      body: {
        url,
        update_types: ['bot_started', 'message_created', 'message_callback'],
        secret,
      },
    });
  }

  private async request(path: string, options: MaxRequestOptions = {}): Promise<unknown> {
    if (!env.MAX_BOT_TOKEN) {
      throw new Error('MAX_BOT_TOKEN is not configured');
    }

    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const response = await requestMaxApi(
      new URL(path, env.MAX_API_BASE_URL),
      options.method ?? 'GET',
      {
        Authorization: env.MAX_BOT_TOKEN,
        'Content-Type': 'application/json',
        ...(body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(body)) }),
      },
      body,
      options.timeoutMs ?? 10_000,
    );

    if (!response.ok) {
      throw new MaxApiError('MAX API request failed', response.status, response.body);
    }
    return response.body;
  }
}
