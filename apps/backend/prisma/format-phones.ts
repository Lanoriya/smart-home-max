import { PrismaClient } from '@prisma/client';

// Writes the phones of management companies the same way: +7 (XXX) XXX-XX-XX.
// Phones copied from the open registry earlier were kept as they came.
//   tsx prisma/format-phones.ts

const prisma = new PrismaClient();

function russian(value: string) {
  for (const part of [value, ...(value.match(/\+?[78]?[\s(.-]*\d[\d\s().-]{8,}\d/g) ?? [])]) {
    const digits = part.replace(/\D/g, '');
    const national = digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits.length === 10 ? digits : '';
    if (/^[3489]\d{9}$/.test(national)) return `+7 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8)}`;
  }
  return null;
}

async function main() {
  const companies = await prisma.managementCompany.findMany({ select: { id: true, phone: true } });
  let changed = 0;
  for (const company of companies) {
    const phone = russian(company.phone);
    if (phone && phone !== company.phone) {
      await prisma.managementCompany.update({ where: { id: company.id }, data: { phone } });
      changed += 1;
    }
  }
  console.log(`Phones formatted: ${changed} of ${companies.length}`);
}

main().finally(async () => prisma.$disconnect());
