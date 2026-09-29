import { z } from 'zod';
import { hashPassword } from './auth/password.js';
import { logger } from './shared/logger.js';
import { prisma } from './shared/prisma.js';

const credentials = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(200),
}).parse({
  username: process.env.ADMIN_SEED_USERNAME,
  password: process.env.ADMIN_SEED_PASSWORD,
});

async function main() {
  const existing = await prisma.admin.findUnique({ where: { username: credentials.username } });
  if (existing) {
    logger.info({ username: credentials.username }, 'Bootstrap administrator already exists');
    return;
  }
  await prisma.admin.create({
    data: {
      username: credentials.username,
      passwordHash: await hashPassword(credentials.password),
      role: 'supervisor',
    },
  });
  logger.info({ username: credentials.username }, 'Bootstrap administrator created');
}

main()
  .catch((error) => {
    logger.error({ error }, 'Administrator bootstrap failed');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
