import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../shared/prisma.js';

type Db = PrismaClient | Prisma.TransactionClient;

// The profile of an apartment (number of residents, names, phones, cars)
// stays when a resident leaves: the company may have filled it in. The last
// resident who leaves may erase it, so the next residents do not see it. The
// same rule for the bot and the mini-app.
export async function canClearApartmentData(userId: string, apartmentId: string, db: Db = prisma) {
  const [memberships, profile, vehiclesCount] = await Promise.all([
    db.residentMembership.findMany({ where: { apartmentId }, select: { userId: true, revokedAt: true } }),
    db.residentProfile.findUnique({ where: { apartmentId }, select: { residentsCount: true, phones: true, _count: { select: { people: true } } } }),
    db.vehicle.count({ where: { apartmentId } }),
  ]);
  const hasData = Boolean(profile && (profile.residentsCount !== null || profile.phones.length || profile._count.people)) || vehiclesCount > 0;
  if (!hasData) return false;
  const active = memberships.filter((membership) => !membership.revokedAt);
  const own = memberships.find((membership) => membership.userId === userId);
  if (!own) return false;
  return own.revokedAt ? active.length === 0 : active.length === 1;
}

export async function clearApartmentData(tx: Prisma.TransactionClient, apartmentId: string) {
  await tx.vehicle.deleteMany({ where: { apartmentId } });
  const profile = await tx.residentProfile.findUnique({ where: { apartmentId }, select: { id: true } });
  if (profile) {
    await tx.residentPerson.deleteMany({ where: { profileId: profile.id } });
    await tx.residentProfile.update({ where: { id: profile.id }, data: { residentsCount: null, phones: [], phoneVisibility: 'hidden', phoneConsentAt: null } });
  }
}
