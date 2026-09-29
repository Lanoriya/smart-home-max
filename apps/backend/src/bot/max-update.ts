import { z } from 'zod';

const userSchema = z.object({
  user_id: z.union([z.number(), z.string()]),
}).passthrough();

export const maxUpdateSchema = z
  .object({
    update_type: z.string(),
    timestamp: z.number(),
    user: userSchema.optional(),
    message: z
      .object({
        sender: userSchema.optional(),
        body: z
          .object({
            mid: z.string().optional(),
          text: z.string().nullish(),
          attachments: z.array(z.unknown()).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    callback: z
      .object({
        callback_id: z.string(),
        payload: z.string().optional(),
        user: userSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type MaxUpdate = z.infer<typeof maxUpdateSchema>;

export function getMaxUserId(update: MaxUpdate): string | null {
  const raw =
    update.callback?.user.user_id ??
    update.message?.sender?.user_id ??
    update.user?.user_id;
  return raw === undefined ? null : String(raw);
}

export function getMaxUpdateKey(update: MaxUpdate): string {
  const stablePart =
    update.message?.body?.mid ??
    update.callback?.callback_id ??
    getMaxUserId(update) ??
    'anonymous';
  return `${update.update_type}:${update.timestamp}:${stablePart}`;
}

export type IncomingImage = { token: string; url?: string };

export function getMaxImages(update: MaxUpdate): IncomingImage[] {
  const attachments = update.message?.body?.attachments;
  if (!attachments) return [];
  return attachments.flatMap(extractImage);
}

function extractImage(attachment: unknown): IncomingImage[] {
  if (!attachment || typeof attachment !== 'object') return [];
  const value = attachment as Record<string, unknown>;
  const payload = value.payload && typeof value.payload === 'object' ? value.payload as Record<string, unknown> : value;
  const type = String(value.type ?? value.kind ?? '').toLowerCase();
  const token = [payload.token, payload.media_token, payload.file_token].find((item): item is string => typeof item === 'string') ?? '';
  const url = [payload.url, payload.image_url, payload.original_url].find((item): item is string => typeof item === 'string');
  if (type.includes('image') || type.includes('photo') || token || url) return token || url ? [{ token, ...(url ? { url } : {}) }] : [];
  return [];
}
