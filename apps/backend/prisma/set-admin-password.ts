import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

// Gives the platform administrator (found by their MAX id) a login and a
// password for the sign-in page of the site. The password comes from the
// environment, never from the command line, so it stays out of the history.
//   ADMIN_MAX_USER_ID=... ADMIN_LOGIN=admin ADMIN_PASSWORD=... tsx prisma/set-admin-password.ts

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

async function main() {
  const maxUserId = process.env.ADMIN_MAX_USER_ID ?? '';
  const login = process.env.ADMIN_LOGIN ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!/^\d+$/.test(maxUserId) || password.length < 10 || !/^[a-z0-9._-]{3,60}$/i.test(login)) {
    throw new Error('Set ADMIN_MAX_USER_ID, ADMIN_LOGIN (3-60 latin letters, digits, . _ -) and ADMIN_PASSWORD (10+ characters)');
  }
  const admin = await prisma.admin.findUnique({ where: { maxUserId }, select: { id: true, role: true } });
  if (!admin || admin.role !== 'platform_admin') throw new Error('No platform administrator with this MAX id: open the mini-app from that account first');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  await prisma.admin.update({ where: { id: admin.id }, data: { username: login, passwordHash: `scrypt$${salt}$${derived.toString('hex')}` } });
  console.log(`Login "${login}" set for the platform administrator`);
}

main().finally(() => prisma.$disconnect());
