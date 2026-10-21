import { prisma } from '../shared/prisma.js';

// Wrong house, contract and apartment codes are counted per person in the
// database, the same for the bot and the mini-app: five an hour. Starting the
// dialog again does not give new attempts.
export const codeAttemptsPerHour = 5;

const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

export async function codeAttemptsLeft(userId: string) {
  const failures = await prisma.codeAttempt.count({ where: { userId, createdAt: { gte: hourAgo() } } });
  return Math.max(0, codeAttemptsPerHour - failures);
}

// Records a wrong code and tells how many attempts are left within the hour.
export async function registerCodeFailure(userId: string) {
  await prisma.codeAttempt.create({ data: { userId } });
  return codeAttemptsLeft(userId);
}
