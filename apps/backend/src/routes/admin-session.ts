import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { verifyPassword } from '../auth/password.js';
import {
  adminCookieName,
  clearAdminCookie,
  getAuthenticatedAdmin,
  hashSessionToken,
  newSessionToken,
  readCookie,
  setAdminCookie,
} from '../auth/session.js';
import { prisma } from '../shared/prisma.js';

export const adminSessionRouter = Router();
const failedLogins = new Map<string, { count: number; blockedUntil: number }>();
const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

adminSessionRouter.get('/', async (request, response, next) => {
  try {
    const session = await getAuthenticatedAdmin(request);
    if (!session) {
      response.status(401).json({ code: 'authentication_required' });
      return;
    }
    response.json({ admin: publicAdmin(session.admin) });
  } catch (error) {
    next(error);
  }
});

adminSessionRouter.post('/', async (request, response, next) => {
  try {
    const key = request.ip ?? 'unknown';
    const attempt = failedLogins.get(key);
    if (attempt && attempt.blockedUntil > Date.now()) {
      response.status(429).json({ code: 'login_temporarily_blocked' });
      return;
    }

    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'invalid_credentials_format' });
      return;
    }
    const admin = await prisma.admin.findUnique({ where: { username: parsed.data.username } });
    const valid = admin ? await verifyPassword(parsed.data.password, admin.passwordHash) : false;
    if (!admin || !valid) {
      registerFailedLogin(key);
      response.status(401).json({ code: 'invalid_credentials' });
      return;
    }

    failedLogins.delete(key);
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.adminSession.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
      prisma.adminSession.create({
        data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt },
      }),
    ]);
    setAdminCookie(response, token);
    response.json({ admin: publicAdmin(admin) });
  } catch (error) {
    next(error);
  }
});

adminSessionRouter.delete('/', async (request, response, next) => {
  try {
    const token = readCookie(request, adminCookieName);
    if (token) {
      await prisma.adminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    }
    clearAdminCookie(response);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

function registerFailedLogin(key: string) {
  if (failedLogins.size > 10_000) {
    const now = Date.now();
    for (const [storedKey, value] of failedLogins) {
      if (value.blockedUntil < now) failedLogins.delete(storedKey);
    }
  }
  const previous = failedLogins.get(key);
  const count = (previous?.count ?? 0) + 1;
  failedLogins.set(key, {
    count,
    blockedUntil: count >= 5 ? Date.now() + 5 * 60 * 1000 : 0,
  });
}

function publicAdmin(admin: { id: string; username: string; role: string }) {
  return { id: admin.id, username: admin.username, role: admin.role };
}
