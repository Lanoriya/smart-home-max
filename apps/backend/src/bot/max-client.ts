import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { rootCertificates } from 'node:tls';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import type { CallbackButton, ImageAttachment, Messenger } from './messenger.js';
import { Html, toHtml, toPlainText } from '../shared/html.js';
import { maxUpdateSchema, type MaxUpdate } from './max-update.js';
import { withSigns } from './button-emoji.js';
import { resolveAppButtons } from './app-buttons.js';
import { z } from 'zod';

type MaxRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
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

// MAX rejects messages longer than 4000 characters; a long incident card with
// comments must still be delivered instead of failing the whole update.
const maxMessageLength = 4000;

// Text is sent as HTML. A message that is too long is sent as plain text cut
// to the limit: cutting markup could leave an unclosed tag.
function messageBody(text: string | Html) {
  const rendered = toHtml(text);
  if (rendered.length <= maxMessageLength) return { text: rendered, format: 'html' };
  const plain = toPlainText(text);
  return { text: plain.length <= maxMessageLength ? plain : `${plain.slice(0, maxMessageLength - 1)}…` };
}

// MAX cuts button text that does not fit. A row of two or three buttons with
// a long label is split so that each button gets the full width.
const rowTextLimit: Record<number, number> = { 1: 64, 2: 18, 3: 11 };
export function fitRows(buttons: CallbackButton[][]): CallbackButton[][] {
  return buttons.flatMap((row) => {
    const limit = rowTextLimit[row.length] ?? 7;
    return row.length > 1 && row.some((button) => button.text.length > limit) ? row.map((button) => [button]) : [row];
  });
}

// Buttons that open the mini-app need the public nick of the bot; without it
// they are left out and the rest of the keyboard is sent as usual.
export function withAvailableButtons(buttons: CallbackButton[][], botUsername = env.MAX_BOT_USERNAME): CallbackButton[][] {
  if (botUsername) return buttons;
  return buttons.map((row) => row.filter((button) => !button.openApp)).filter((row) => row.length);
}

export function keyboardAttachments(buttons: CallbackButton[][], botUsername = env.MAX_BOT_USERNAME) {
  const available = withAvailableButtons(buttons, botUsername);
  if (!available.length) return [];
  return [{
    type: 'inline_keyboard',
    payload: {
      buttons: fitRows(available).map((row) => row.map((button) => (button.openApp
        ? { type: 'open_app', text: button.text, web_app: botUsername, ...(button.payload ? { payload: button.payload } : {}) }
        : button.requestContact
        ? { type: 'request_contact', text: button.text }
        : button.url
        ? { type: 'link', text: button.text, url: button.url }
        : { type: 'callback', text: button.text, payload: button.payload, ...(button.intent ? { intent: button.intent } : {}) }))),
    },
  }];
}

function newMessageBody(text: string | Html, buttons: CallbackButton[][], images: ImageAttachment[]) {
  const attachments = [
    ...images.map((image) => ({ type: 'image', payload: image.token ? { token: image.token } : { url: image.url } })),
    ...keyboardAttachments(buttons),
  ];
  return { ...messageBody(text), ...(attachments.length ? { attachments } : {}) };
}

const sentMessageSchema = z.object({ message: z.object({ body: z.object({ mid: z.string() }) }) });

// MAX refuses the whole message when a link button points somewhere it does
// not accept (for example a mistyped chat link). The message is then sent
// again without link buttons, so the resident still gets the screen.
async function withoutRejectedLinks<T>(buttons: CallbackButton[][], send: (keyboard: CallbackButton[][]) => Promise<T>): Promise<T> {
  try {
    return await send(buttons);
  } catch (error) {
    const hasLinks = buttons.some((row) => row.some((button) => button.url || button.openApp));
    const rejectedLink = error instanceof MaxApiError && error.status === 400 && /link|app|button/i.test(JSON.stringify(error.responseBody));
    if (!hasLinks || !rejectedLink) throw error;
    logger.warn({ error }, 'MAX rejected a link button, sending without links');
    return send(buttons.map((row) => row.filter((button) => !button.url && !button.openApp)).filter((row) => row.length));
  }
}

// Edit and delete answer HTTP 200 with {"success": false} when they fail, for
// example for a message that no longer exists.
function assertSucceeded(response: unknown) {
  if (response && typeof response === 'object' && (response as { success?: unknown }).success === false) {
    throw new MaxApiError(`MAX API refused the operation: ${String((response as { message?: unknown }).message ?? '')}`, 200, response);
  }
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
    text: string | Html,
    buttons: CallbackButton[][] = [],
    images: ImageAttachment[] = [],
  ): Promise<string | null> {
    buttons = withSigns(resolveAppButtons(buttons, userId));
    if (env.MAX_MODE === 'fake') {
      logger.info({ userId, text: toPlainText(text), buttons }, 'Fake MAX message');
      return `fake-${randomUUID()}`;
    }
    const response = await withoutRejectedLinks(buttons, (keyboard) => this.request(`/messages?user_id=${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: newMessageBody(text, keyboard, images),
    }));
    return sentMessageSchema.safeParse(response).data?.message.body.mid ?? null;
  }

  // Replaces text and keyboard of a sent message. An empty attachment list is
  // sent explicitly so a keyboard that is no longer needed disappears.
  async editMessage(messageId: string, text: string | Html, buttons: CallbackButton[][] = []): Promise<void> {
    buttons = withSigns(buttons);
    if (env.MAX_MODE === 'fake') {
      logger.info({ messageId, text: toPlainText(text), buttons }, 'Fake MAX message edit');
      return;
    }
    assertSucceeded(await withoutRejectedLinks(buttons, (keyboard) => this.request(`/messages?message_id=${encodeURIComponent(messageId)}`, {
      method: 'PUT',
      body: { ...newMessageBody(text, keyboard, []), attachments: keyboardAttachments(keyboard) },
    })));
  }

  async deleteMessage(messageId: string): Promise<void> {
    if (env.MAX_MODE === 'fake') {
      logger.info({ messageId }, 'Fake MAX message delete');
      return;
    }
    assertSucceeded(await this.request(`/messages?message_id=${encodeURIComponent(messageId)}`, { method: 'DELETE' }));
  }

  async getMe(): Promise<unknown> {
    return this.request('/me');
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

  async deleteWebhookSubscription(url: string): Promise<unknown> {
    return this.request(`/subscriptions?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
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
