import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, storedHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !storedHex) return false;
  const stored = Buffer.from(storedHex, 'hex');
  const actual = await scrypt(password, salt, stored.length) as Buffer;
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}
