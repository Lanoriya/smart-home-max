import { createHash, randomBytes } from 'node:crypto';
import type { AdminRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../shared/prisma.js';

export const adminCookieName = 'smart_home_admin';

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(request: Request, name: string): string | null {
  const source = request.headers.cookie;
  if (!source) return null;
  for (const part of source.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function setAdminCookie(response: Response, token: string) {
  response.cookie(adminCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.ADMIN_COOKIE_SECURE,
    path: '/',
    maxAge: env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
}

export function clearAdminCookie(response: Response) {
  response.clearCookie(adminCookieName, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.ADMIN_COOKIE_SECURE,
    path: '/',
  });
}

export async function getAuthenticatedAdmin(request: Request) {
  const token = readCookie(request, adminCookieName);
  if (!token) return null;
  return prisma.adminSession.findFirst({
    where: { tokenHash: hashSessionToken(token), expiresAt: { gt: new Date() } },
    include: { admin: true },
  });
}

export async function requireAdmin(request: Request, response: Response, next: NextFunction) {
  try {
    const session = await getAuthenticatedAdmin(request);
    if (!session) {
      response.status(401).json({ code: 'authentication_required' });
      return;
    }
    response.locals.admin = session.admin;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: AdminRole[]) {
  return (_request: Request, response: Response, next: NextFunction) => {
    const admin = response.locals.admin as { role?: AdminRole } | undefined;
    if (!admin || !admin.role || !roles.includes(admin.role)) {
      response.status(403).json({ code: 'insufficient_permissions' });
      return;
    }
    next();
  };
}
