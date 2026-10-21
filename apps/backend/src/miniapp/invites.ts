import { createHash, randomBytes } from 'node:crypto';
import type { AdminRole } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { env } from '../config/env.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import type { AdminActor } from '../auth/scope.js';

// Administrators of a company join by a one-time link: the platform invites
// the first supervisor of a new company, a supervisor invites dispatchers.
// The link opens the mini-app with "invite_<token>"; whoever opens it in MAX
// becomes the administrator, so no passwords travel anywhere.

const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export const invitePrefix = 'invite_';

export function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

// With a registered mini-app the link opens it directly; otherwise it opens
// the bot, which answers with a personal link to the app.
export function inviteLink(token: string, botUsername = env.MAX_BOT_USERNAME) {
  if (!botUsername) return null;
  const parameter = env.MINIAPP_OPEN_MODE === 'link' ? 'start' : 'startapp';
  return `https://max.ru/${botUsername}?${parameter}=${invitePrefix}${token}`;
}

export async function createInvite(admin: AdminActor, companyId: string, role: Extract<AdminRole, 'dispatcher' | 'supervisor'>) {
  const token = randomBytes(18).toString('base64url');
  const expiresAt = new Date(Date.now() + inviteLifetimeMs);
  await prisma.$transaction(async (tx) => {
    const invite = await tx.adminInvite.create({ data: { tokenHash: hashInviteToken(token), companyId, role, createdByAdminId: admin.id, expiresAt } });
    await writeAdminAudit(tx, admin.id, 'admin_invite_created', 'admin_invite', invite.id, { companyId, role });
  });
  return { startParam: `${invitePrefix}${token}`, link: inviteLink(token), expiresAt, role };
}

export type AcceptResult =
  | { ok: true; role: AdminRole; company: { id: string; name: string } }
  | { ok: false; code: 'invite_not_found' | 'invite_used' | 'invite_expired' | 'admin_of_another_company' | 'platform_admin' };

export async function previewInvite(token: string) {
  const invite = await prisma.adminInvite.findUnique({ where: { tokenHash: hashInviteToken(token) }, include: { company: { select: { id: true, name: true } } } });
  if (!invite) return null;
  return { role: invite.role, company: invite.company, expiresAt: invite.expiresAt, used: Boolean(invite.usedAt), expired: invite.expiresAt < new Date() };
}

export async function acceptInvite(user: { maxUserId: string; displayName: string | null }, token: string): Promise<AcceptResult> {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.adminInvite.findUnique({ where: { tokenHash: hashInviteToken(token) }, include: { company: { select: { id: true, name: true } } } });
    if (!invite) return { ok: false, code: 'invite_not_found' };
    if (invite.usedAt) return { ok: false, code: 'invite_used' };
    if (invite.expiresAt < new Date()) return { ok: false, code: 'invite_expired' };
    const existing = await tx.admin.findUnique({ where: { maxUserId: user.maxUserId } });
    if (existing?.role === 'platform_admin') return { ok: false, code: 'platform_admin' };
    if (existing && existing.companyId !== invite.companyId) return { ok: false, code: 'admin_of_another_company' };
    // A conditional update so that two people opening the link at once
    // cannot both use it.
    const claimed = await tx.adminInvite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) return { ok: false, code: 'invite_used' };
    const admin = existing
      ? await tx.admin.update({ where: { id: existing.id }, data: { role: invite.role, displayName: user.displayName } })
      : await tx.admin.create({
        data: {
          username: `max_${user.maxUserId}`,
          // Not a valid scrypt record: such an account works only through MAX.
          passwordHash: '!',
          role: invite.role,
          companyId: invite.companyId,
          maxUserId: user.maxUserId,
          displayName: user.displayName,
        },
      });
    await tx.adminInvite.update({ where: { id: invite.id }, data: { usedByAdminId: admin.id } });
    await writeAdminAudit(tx, admin.id, 'admin_invite_accepted', 'admin_invite', invite.id, { companyId: invite.companyId, role: invite.role });
    return { ok: true, role: admin.role, company: invite.company };
  });
}
