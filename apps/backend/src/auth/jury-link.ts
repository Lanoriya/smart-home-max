import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../shared/prisma.js';
import { env } from '../config/env.js';
import { writeAdminAudit } from './admin-audit.js';

// Links for the jury of the hackathon: https://max.ru/<bot>?start=jury_uk_<token>
// makes whoever opens it an employee of the demo company of the user
// "jury-uk", ...?start=jury_admin_<token> makes them a platform administrator.
// Each link works only while its token is set in the environment, so removing
// JURY_UK_LINK_TOKEN / JURY_ADMIN_LINK_TOKEN switches it off. After the jury
// has looked at the service, the links stop working by themselves.

export type JuryRole = 'uk' | 'admin';

export const juryLinksUntil = new Date('2026-11-05T23:59:59+03:00');

const juryPattern = /^jury_(uk|admin)_([A-Za-z0-9_-]{12,100})$/;

function sameToken(given: string, expected: string | undefined) {
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// "expired" — a jury link after juryLinksUntil, so the bot can say so.
export function juryRoleFromStartPayload(payload: string | null, now = new Date()): JuryRole | 'expired' | null {
  const match = payload ? juryPattern.exec(payload) : null;
  if (!match) return null;
  const [, kind, token] = match;
  const role = kind as JuryRole;
  if (!token || !sameToken(token, role === 'uk' ? env.JURY_UK_LINK_TOKEN : env.JURY_ADMIN_LINK_TOKEN)) return null;
  return now > juryLinksUntil ? 'expired' : role;
}

export function juryLink(role: JuryRole, botUsername = env.MAX_BOT_USERNAME) {
  const token = role === 'uk' ? env.JURY_UK_LINK_TOKEN : env.JURY_ADMIN_LINK_TOKEN;
  if (!botUsername || !token) return null;
  return `https://max.ru/${botUsername}?start=jury_${role}_${token}`;
}

export type JuryGrant =
  | { ok: true; role: JuryRole; companyName: string | null }
  | { ok: false; code: 'no_demo_company' | 'platform_admin' | 'admin_of_another_company' };

export async function grantJuryRole(maxUserId: string, displayName: string | null, role: JuryRole): Promise<JuryGrant> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.admin.findUnique({ where: { maxUserId } });
    if (role === 'admin') {
      const admin = existing
        ? await tx.admin.update({ where: { id: existing.id }, data: { role: 'platform_admin', companyId: null } })
        : await tx.admin.create({ data: { username: `jury_admin_max_${maxUserId}`, passwordHash: '!', role: 'platform_admin', maxUserId, displayName } });
      await writeAdminAudit(tx, admin.id, 'jury_link_used', 'admin', admin.id, { role });
      return { ok: true, role, companyName: null };
    }
    const demo = await tx.admin.findUnique({ where: { username: 'jury-uk' }, select: { company: { select: { id: true, name: true } } } });
    if (!demo?.company) return { ok: false, code: 'no_demo_company' };
    // A platform administrator already sees every company; a real employee
    // of another company is not moved away from it.
    if (existing?.role === 'platform_admin') return { ok: false, code: 'platform_admin' };
    if (existing && existing.companyId !== demo.company.id) return { ok: false, code: 'admin_of_another_company' };
    const admin = existing
      ? await tx.admin.update({ where: { id: existing.id }, data: { role: 'supervisor' } })
      : await tx.admin.create({
        data: { username: `jury_uk_max_${maxUserId}`, passwordHash: '!', role: 'supervisor', companyId: demo.company.id, maxUserId, displayName },
      });
    await writeAdminAudit(tx, admin.id, 'jury_link_used', 'admin', admin.id, { role, companyId: demo.company.id });
    return { ok: true, role, companyName: demo.company.name };
  });
}
