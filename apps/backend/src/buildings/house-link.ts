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
