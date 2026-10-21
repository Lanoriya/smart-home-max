import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// Puts the starting codes on every house and apartment: house 0000000000,
// apartment 000000. For pilots and demos, where codes are not handed out yet.
//   APARTMENT_CODE_PEPPER=... tsx prisma/default-codes.ts

const prisma = new PrismaClient();

// The same hash as src/users/invite-code.ts (the built image has no sources).
const hashInviteCode = (code: string, pepper: string) => createHmac('sha256', pepper).update(code, 'utf8').digest('hex');
const pepper = process.env.APARTMENT_CODE_PEPPER;
if (!pepper) throw new Error('APARTMENT_CODE_PEPPER is required');

async function main() {
  const houses = await prisma.building.updateMany({ data: { accessCode: '0000000000' } });
  const flats = await prisma.apartment.updateMany({ data: { inviteCodeHash: hashInviteCode('000000', pepper!) } });
  console.log(`Codes reset: ${houses.count} houses, ${flats.count} apartments`);
}

main().finally(async () => prisma.$disconnect());
