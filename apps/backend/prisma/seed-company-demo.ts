import { PrismaClient } from '@prisma/client';

// Demo contacts for every management company: working hours, reception of
// residents, days off and five emergency services with phones. Filled only
// where the company has nothing yet, so real data typed in later stays.
// Old platform-wide test services ("Тестовый …") are removed.
//   tsx prisma/seed-company-demo.ts

const prisma = new PrismaClient();

const hours = {
  workingHours: 'Пн–Чт 8:00–17:00, Пт 8:00–16:00, обед 12:00–13:00',
  receptionHours: 'Вт 10:00–13:00, Чт 15:00–19:00',
  daysOff: 'Сб, Вс и праздничные дни',
};

function services(index: number) {
  const n = String(index).padStart(2, '0');
  return [
    { name: 'Аварийно-диспетчерская служба УК', phone: `+7 (900) 2${n}-00-01`, description: 'Круглосуточно: протечки, отключения, аварии в доме. Демонстрационный номер' },
    { name: 'Водоканал, аварийная служба', phone: `+7 (900) 2${n}-00-02`, description: 'Нет воды, прорыв трубы, засор канализации. Демонстрационный номер' },
    { name: 'Электросети, аварийная служба', phone: `+7 (900) 2${n}-00-03`, description: 'Нет света в доме или на улице, искрит проводка. Демонстрационный номер' },
    { name: 'Газовая служба', phone: '104', description: 'Запах газа — звоните сразу, с любого телефона' },
    { name: 'Лифтовая аварийная служба', phone: `+7 (900) 2${n}-00-05`, description: 'Застрял лифт, человек в кабине. Демонстрационный номер' },
  ];
}

async function main() {
  const removed = await prisma.emergencyService.deleteMany({ where: { companyId: null, name: { startsWith: 'Тестов' } } });
  const companies = await prisma.managementCompany.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, workingHours: true, receptionHours: true, daysOff: true, _count: { select: { emergencyServices: true } } } });
  let filled = 0;
  let added = 0;
  for (const [index, company] of companies.entries()) {
    if (!company.workingHours || !company.receptionHours || !company.daysOff) {
      await prisma.managementCompany.update({
        where: { id: company.id },
        data: {
          ...(company.workingHours ? {} : { workingHours: hours.workingHours }),
          ...(company.receptionHours ? {} : { receptionHours: hours.receptionHours }),
          ...(company.daysOff ? {} : { daysOff: hours.daysOff }),
        },
      });
      filled += 1;
    }
    if (company._count.emergencyServices === 0) {
      await prisma.emergencyService.createMany({ data: services(index + 1).map((service) => ({ ...service, companyId: company.id })) });
      added += 5;
    }
  }
  console.log(`Test services removed: ${removed.count}; companies with hours filled: ${filled}; services added: ${added}`);
}

main().finally(async () => prisma.$disconnect());
