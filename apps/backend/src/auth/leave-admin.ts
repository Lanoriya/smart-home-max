import { prisma } from '../shared/prisma.js';
import { env } from '../config/env.js';
import { revokeAdminAccess } from './revoke-admin.js';
import { writeAdminAudit } from './admin-audit.js';
import { juryDemoUsername } from './jury-link.js';

// A company employee or a platform administrator gives up their access
// themselves — from the bot, the mini-app or the web desk. The record stays
// for the history (see revokeAdminAccess); coming back takes a new invitation.

// The password sign-ins printed in the materials for the jury.
const demoAccounts = [juryDemoUsername, 'jury-admin'];

export type LeaveAdminResult =
  | { ok: true; role: 'platform_admin' | 'company'; companyName: string | null }
  | { ok: false; code: 'admin_not_found' | 'platform_admin_from_env' | 'demo_account' };

export async function leaveAdmin(adminId: string): Promise<LeaveAdminResult> {
  const record = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, role: true, username: true, displayName: true, companyId: true, maxUserId: true, company: { select: { name: true } } },
  });
  if (!record || (!record.companyId && record.role !== 'platform_admin')) return { ok: false, code: 'admin_not_found' };
  // Such an account would get its rights back on the next visit.
  if (record.role === 'platform_admin' && record.maxUserId && env.PLATFORM_ADMIN_MAX_USER_IDS.includes(record.maxUserId)) return { ok: false, code: 'platform_admin_from_env' };
  if (demoAccounts.includes(record.username)) return { ok: false, code: 'demo_account' };
  await prisma.$transaction(async (tx) => {
    await revokeAdminAccess(tx, record);
    await writeAdminAudit(tx, record.id, record.role === 'platform_admin' ? 'platform_admin_left' : 'company_admin_left', 'admin', record.id, { companyId: record.companyId });
  });
  return { ok: true, role: record.role === 'platform_admin' ? 'platform_admin' : 'company', companyName: record.company?.name ?? null };
}
