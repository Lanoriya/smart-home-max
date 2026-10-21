import { env } from '../config/env.js';
import { prisma } from '../shared/prisma.js';
import { hashSessionToken, newSessionToken } from './session.js';

// A one-time link into the web desk for an employee already known by MAX:
// five minutes, one use, no password.
export async function createWebLoginLink(adminId: string) {
  const token = newSessionToken();
  await prisma.$transaction([
    prisma.adminLoginLink.deleteMany({ where: { OR: [{ expiresAt: { lte: new Date() } }, { usedAt: { not: null } }] } }),
    prisma.adminLoginLink.create({ data: { adminId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 5 * 60 * 1000) } }),
  ]);
  const url = new URL('/', env.ADMIN_WEB_ORIGIN);
  url.searchParams.set('login', token);
  return url.toString();
}
