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
  if (value.type === 'contact') return [];
  const payload = value.payload && typeof value.payload === 'object' ? value.payload as Record<string, unknown> : value;
  const type = String(value.type ?? value.kind ?? '').toLowerCase();
  const token = [payload.token, payload.media_token, payload.file_token].find((item): item is string => typeof item === 'string') ?? '';
  const url = [payload.url, payload.image_url, payload.original_url].find((item): item is string => typeof item === 'string');
  if (type.includes('image') || type.includes('photo') || token || url) return token || url ? [{ token, ...(url ? { url } : {}) }] : [];
  return [];
}

// The name from the MAX profile, used to tell residents who asks to join
// their apartment. MAX sends "name" or "first_name"/"last_name".
export function getMaxUserName(update: MaxUpdate): string | null {
  const raw = (update.callback?.user ?? update.message?.sender ?? update.user) as Record<string, unknown> | undefined;
  if (!raw) return null;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const full = text(raw.name) || [text(raw.first_name), text(raw.last_name)].filter(Boolean).join(' ') || (text(raw.username) ? `@${text(raw.username)}` : '');
  return full ? full.slice(0, 120) : null;
}

export function getMaxUsername(update: MaxUpdate): string | null {
  const raw = (update.callback?.user ?? update.message?.sender ?? update.user) as Record<string, unknown> | undefined;
  const value = typeof raw?.username === 'string' ? raw.username.trim().replace(/^@/, '') : '';
  return /^[\w.]{2,64}$/.test(value) ? value : null;
}

export type SharedContact = { phone: string | null; ownerId: string | null; attachmentShape: string };

// A contact sent with the "share contact" button. MAX describes it with a
// vCard ("vcf_info") and the owner's MAX profile ("max_info"); a plain phone
// field is accepted too in case the format differs.
export function getMaxContact(update: MaxUpdate): SharedContact | null {
  const attachments = update.message?.body?.attachments;
  const contact = attachments?.find((attachment) => (attachment as { type?: unknown })?.type === 'contact') as Record<string, unknown> | undefined;
  if (!contact) return null;
  const payload = (contact.payload && typeof contact.payload === 'object' ? contact.payload : contact) as Record<string, unknown>;
  const vcf = typeof payload.vcf_info === 'string' ? payload.vcf_info : typeof payload.vcf === 'string' ? payload.vcf : '';
  const telLine = vcf.match(/TEL[^:\n]*:([^\n\r]+)/i)?.[1];
  const direct = [payload.phone, payload.phone_number, (payload.vcf_phone as unknown)].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const phone = (telLine ?? direct ?? '').trim() || null;
  const maxInfo = (payload.max_info && typeof payload.max_info === 'object' ? payload.max_info : null) as Record<string, unknown> | null;
  const ownerId = maxInfo && (typeof maxInfo.user_id === 'number' || typeof maxInfo.user_id === 'string') ? String(maxInfo.user_id) : null;
  // Only the structure is logged, never the phone itself.
  const attachmentShape = JSON.stringify(Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value && typeof value === 'object' ? Object.keys(value) : typeof value])));
  return { phone, ownerId, attachmentShape };
}
