import QRCode from 'qrcode';
import { env } from '../config/env.js';

// The link of one house for a QR code at the entrance. It opens the bot with
// the house already chosen: the resident only types the apartment and proves
// it with the code or the contract, as usual. The link is not a secret — it
// only saves looking for the address.

export const housePrefix = 'house_';
const housePattern = /^house_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function houseLink(buildingId: string, botUsername = env.MAX_BOT_USERNAME) {
  if (!botUsername) return null;
  return `https://max.ru/${botUsername}?start=${housePrefix}${buildingId}`;
}

export function houseFromStartPayload(payload: string | null | undefined) {
  return payload ? housePattern.exec(payload)?.[1] ?? null : null;
}

// The QR code as a picture: MAX takes an image for a bot message only by an
// address, so the picture has a public one, as the link itself is public.
export function houseQrImageUrl(buildingId: string, base = env.MINIAPP_URL) {
  return base ? new URL(`/api/qr/house/${buildingId}.png`, base).toString() : null;
}

export function houseQrPng(link: string): Promise<Buffer> {
  return QRCode.toBuffer(link, { type: 'png', width: 720, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
}
