import { randomInt, timingSafeEqual } from 'node:crypto';

export const buildingCodePattern = /^\d{10}$/;

export function generateBuildingCode(): string {
  return Array.from({ length: 10 }, () => randomInt(10)).join('');
}

export function buildingCodeMatches(value: string, code: string): boolean {
  const received = value.replace(/\s+/g, '');
  if (!buildingCodePattern.test(received)) return false;
  return received.length === code.length && timingSafeEqual(Buffer.from(received), Buffer.from(code));
}
