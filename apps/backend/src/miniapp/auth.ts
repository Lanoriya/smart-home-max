import type { NextFunction, Request, Response } from 'express';
import type { Admin, AdminRole } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../shared/prisma.js';
import { actingCompanyId, type AdminActor } from '../auth/scope.js';
import { verifyInitData, type MiniAppUser } from './init-data.js';
import { verifyLinkToken } from './link-token.js';
import { getAuthenticatedAdmin } from '../auth/session.js';

// Who opened the mini-app. Every request carries the signed launch data of
// MAX in "Authorization: MaxWebApp <initData>"; there are no passwords.
export type MiniAppLocals = {
  user: { id: string; maxUserId: string; displayName: string | null };
  // Set when the same MAX account is a company or platform administrator.
  admin: AdminActor | null;
};

export function miniApp(response: Response): MiniAppLocals {
  return response.locals.miniApp as MiniAppLocals;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUser(request: Request): MiniAppUser | 'expired' | null {
  if (env.MINIAPP_DEV_AUTH && env.NODE_ENV !== 'production') {
    const devId = request.header('x-dev-max-user-id');
    // The development sign-in knows only the id: the name stays as MAX gave it.
    if (devId && /^\d{1,20}$/.test(devId)) return { maxUserId: devId, displayName: null, username: null };
  }
  const header = request.header('authorization') ?? '';
  const [scheme, ...rest] = header.split(' ');
  if (scheme === 'MaxLink' && rest.length === 1 && env.MAX_BOT_TOKEN) {
    const link = verifyLinkToken(rest[0]!, env.MAX_BOT_TOKEN);
    if (link === 'expired') return 'expired';
    return link ? { maxUserId: link.maxUserId, displayName: null, username: null } : null;
  }
  if (scheme !== 'MaxWebApp' || !rest.length || !env.MAX_BOT_TOKEN) return null;
  const result = verifyInitData(rest.join(' '), env.MAX_BOT_TOKEN);
  if (result.ok) return result.data.user;
  return result.error === 'expired' ? 'expired' : null;
}

export async function requireMiniAppUser(request: Request, response: Response, next: NextFunction) {
  try {
    const identity = readUser(request) ?? await webDeskUser(request);
    if (identity === 'expired') { response.status(401).json({ code: 'launch_data_expired' }); return; }
    if (!identity) { response.status(401).json({ code: 'launch_data_required' }); return; }

    const user = await prisma.user.upsert({
      where: { maxUserId: identity.maxUserId },
      create: { maxUserId: identity.maxUserId, displayName: identity.displayName, maxUsername: identity.username },
      update: { ...(identity.displayName ? { displayName: identity.displayName } : {}), ...(identity.username ? { maxUsername: identity.username } : {}) },
      select: { id: true, maxUserId: true, displayName: true },
    });
    const admin = await resolveAdmin(identity);
    response.locals.miniApp = {
      user,
      admin: admin ? { id: admin.id, username: admin.username, role: admin.role, companyId: admin.companyId } : null,
    } satisfies MiniAppLocals;
    next();
  } catch (error) {
    next(error);
  }
}

// The web desk calls the same API with its session cookie: the signed-in
// administrator acts as their MAX account. The cookie is SameSite=Strict, and
// the extra header cannot be set by a form of another site either.
async function webDeskUser(request: Request): Promise<MiniAppUser | null> {
  if (request.header('authorization') || request.header('x-web-desk') !== '1') return null;
  const session = await getAuthenticatedAdmin(request);
  const maxUserId = session?.admin.maxUserId;
  return maxUserId ? { maxUserId, displayName: null, username: null } : null;
}

// MAX accounts listed in PLATFORM_ADMIN_MAX_USER_IDS get a platform
// administrator record on their first visit; others are administrators only
// if they accepted an invitation.
async function resolveAdmin(identity: MiniAppUser): Promise<Admin | null> {
  const existing = await prisma.admin.findUnique({ where: { maxUserId: identity.maxUserId } });
  if (!env.PLATFORM_ADMIN_MAX_USER_IDS.includes(identity.maxUserId)) return existing;
  if (existing?.role === 'platform_admin') return existing;
  if (existing) return prisma.admin.update({ where: { id: existing.id }, data: { role: 'platform_admin', companyId: null } });
  return prisma.admin.create({
    data: {
      username: `max_${identity.maxUserId}`,
      // Not a valid scrypt record: this account can never sign in with a password.
      passwordHash: '!',
      role: 'platform_admin',
      maxUserId: identity.maxUserId,
      displayName: identity.displayName,
    },
  });
}

// Company endpoints of the mini-app. A platform administrator chooses the
// company with the X-Company-Id header.
export function requireMiniAppAdmin(...roles: AdminRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const { admin } = miniApp(response);
    if (!admin) { response.status(403).json({ code: 'not_an_administrator' }); return; }
    if (roles.length && !roles.includes(admin.role) && admin.role !== 'platform_admin') {
      response.status(403).json({ code: 'insufficient_permissions' });
      return;
    }
    const requested = request.header('x-company-id');
    response.locals.companyId = actingCompanyId(admin, requested && uuidPattern.test(requested) ? requested : null);
    next();
  };
}

export function requirePlatformAdmin(_request: Request, response: Response, next: NextFunction) {
  if (miniApp(response).admin?.role !== 'platform_admin') { response.status(403).json({ code: 'insufficient_permissions' }); return; }
  next();
}
