import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
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
import { companyZone } from '../shared/time-zone.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminSessionRouter = Router();

adminSessionRouter.get('/', async (request, response, next) => {
  try {
    const session = await getAuthenticatedAdmin(request);
    if (!session) {
      response.status(401).json({ code: 'authentication_required' });
      return;
    }
    // The clock of the desk: the zone of the company it works for (the own
    // one, or the one a platform administrator chose in X-Company-Id).
    const requested = request.header('x-company-id');
    const companyId = session.admin.role === 'platform_admin' ? (requested && uuidPattern.test(requested) ? requested : null) : session.admin.companyId;
    response.json({ admin: publicAdmin(session.admin), timeZone: companyId ? await companyZone(companyId) : null });
  } catch (error) {
    next(error);
  }
});

// What the sign-in page shows: the link to the bot in MAX.
adminSessionRouter.get('/meta', (_request, response) => {
  response.json({ botUrl: env.MAX_BOT_USERNAME ? `https://max.ru/${env.MAX_BOT_USERNAME}` : null });
});

// Sign-in with a login and password. Only an account that set a password has
// one: company staff come from MAX and have none.
const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

adminSessionRouter.post('/', async (request, response, next) => {
  try {
    const key = request.ip ?? 'unknown';
    if (await isLoginBlocked(key)) { response.status(429).json({ code: 'login_temporarily_blocked' }); return; }
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_credentials_format' }); return; }
    const admin = await prisma.admin.findUnique({ where: { username: parsed.data.username }, include: { company: { select: { id: true, name: true } } } });
    const valid = admin && (admin.companyId || admin.role === 'platform_admin') ? await verifyPassword(parsed.data.password, admin.passwordHash) : false;
    if (!admin || !valid) {
      await registerFailedLogin(key);
      response.status(401).json({ code: 'invalid_credentials' });
      return;
    }
    await prisma.adminLoginFailure.deleteMany({ where: { key } });
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.adminSession.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
      prisma.adminSession.create({ data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt } }),
    ]);
    setAdminCookie(response, token);
    response.json({ admin: publicAdmin(admin) });
  } catch (error) {
    next(error);
  }
});

// The signed-in administrator sets a login and password for the site.
const passwordSchema = z.object({
  username: z.string().trim().min(3).max(60).regex(/^[a-z0-9._-]+$/i),
  password: z.string().min(10).max(200),
});

adminSessionRouter.put('/password', async (request, response, next) => {
  try {
    const session = await getAuthenticatedAdmin(request);
    if (!session) { response.status(401).json({ code: 'authentication_required' }); return; }
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_password' }); return; }
    const taken = await prisma.admin.findFirst({ where: { username: parsed.data.username, id: { not: session.admin.id } }, select: { id: true } });
    if (taken) { response.status(409).json({ code: 'username_taken' }); return; }
    const admin = await prisma.admin.update({
      where: { id: session.admin.id },
      data: { username: parsed.data.username, passwordHash: await hashPassword(parsed.data.password) },
      include: { company: { select: { id: true, name: true } } },
    });
    response.json({ admin: publicAdmin(admin) });
  } catch (error) {
    next(error);
  }
});

// Sign-in by a one-time link from the mini-app (see /api/app/company/web-link).
adminSessionRouter.post('/link', async (request, response, next) => {
  try {
    const key = request.ip ?? 'unknown';
    if (await isLoginBlocked(key)) { response.status(429).json({ code: 'login_temporarily_blocked' }); return; }
    const parsed = z.object({ token: z.string().trim().min(20).max(200) }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_login_link' }); return; }
    const link = await prisma.adminLoginLink.findUnique({ where: { tokenHash: hashSessionToken(parsed.data.token) }, include: { admin: { include: { company: { select: { id: true, name: true } } } } } });
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000);
    // The link is spent by a conditional update: of two requests with the
    // same link at the same moment only one gets a session.
    const signedIn = link && await prisma.$transaction(async (tx) => {
      const spent = await tx.adminLoginLink.updateMany({ where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!spent.count) return false;
      await tx.adminSession.create({ data: { adminId: link.adminId, tokenHash: hashSessionToken(token), expiresAt } });
      return true;
    });
    if (!link || !signedIn) {
      await registerFailedLogin(key);
      response.status(401).json({ code: 'login_link_expired' });
      return;
    }
    setAdminCookie(response, token);
    response.json({ admin: publicAdmin(link.admin) });
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

const failureWindowMs = 15 * 60 * 1000;
const blockMs = 5 * 60 * 1000;
const failuresToBlock = 5;

async function isLoginBlocked(key: string) {
  const failure = await prisma.adminLoginFailure.findUnique({ where: { key } });
  return Boolean(failure?.blockedUntil && failure.blockedUntil > new Date());
}

// Five failures within a quarter of an hour block the address for five
// minutes; failures older than that are forgotten.
async function registerFailedLogin(key: string) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - failureWindowMs);
  await prisma.$transaction(async (tx) => {
    await tx.adminLoginFailure.deleteMany({ where: { firstAt: { lt: windowStart }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }] } });
    const failure = await tx.adminLoginFailure.upsert({ where: { key }, create: { key, count: 1, firstAt: now }, update: { count: { increment: 1 } } });
    if (failure.count >= failuresToBlock) {
      await tx.adminLoginFailure.update({ where: { key }, data: { count: 0, firstAt: now, blockedUntil: new Date(now.getTime() + blockMs) } });
    }
  });
}

function publicAdmin(admin: { id: string; username: string; role: string; company?: { id: string; name: string } | null }) {
  return { id: admin.id, username: admin.username, role: admin.role, company: admin.company ?? null };
}
