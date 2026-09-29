import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

type DemoResident = { userId: string; apartmentId: string; apartmentNumber: string; fullName: string };

const demoBuildings = [
  { id: 'd1000000-0000-4000-8000-000000000001', prefix: 'd2000000', address: 'Тестовый №1 Улица демонстрации 10', entrancesCount: 3, apartmentsCount: 100, chatLink: 'https://example.invalid/demo-house-1' },
  { id: 'd1100000-0000-4000-8000-000000000002', prefix: 'd2100000', address: 'Тестовый №2 Улица демонстрации 13', entrancesCount: 4, apartmentsCount: 80, chatLink: 'https://example.invalid/demo-house-2' },
] as const;

const legacyDemoIncidentIds = [
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004',
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000003',
];

const firstNames = ['Алексей', 'Мария', 'Иван', 'Дарья', 'Сергей', 'Анна', 'Максим', 'Елена', 'Дмитрий', 'Ольга'];
const lastNames = ['Иванов', 'Петрова', 'Смирнов', 'Кузнецова', 'Волков', 'Соколова', 'Морозов', 'Попова', 'Орлов', 'Васильева'];

function fixedId(prefix: string, value: number) { return `${prefix}-0000-4000-8000-${String(value).padStart(12, '0')}`; }
function phoneFor(building: number, apartment: number, resident: number) { return `+7900${building}${String(apartment).padStart(5, '0')}${resident}`; }
function residentName(building: number, apartment: number, resident: number) {
  const index = (building * 37 + apartment * 5 + resident) % firstNames.length;
  return `${lastNames[index]} ${firstNames[index]}`;
}

async function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function seedApartments() {
  const residents = new Map<string, DemoResident[]>();
  for (const [buildingIndex, config] of demoBuildings.entries()) {
    const buildingNumber = buildingIndex + 1;
    const { prefix, ...buildingData } = config;
    const building = await prisma.building.upsert({
      where: { id: config.id },
      update: { address: config.address, entrancesCount: config.entrancesCount, apartmentsCount: config.apartmentsCount, chatLink: config.chatLink },
      create: buildingData,
    });
    await prisma.apartment.createMany({
      data: Array.from({ length: config.apartmentsCount }, (_, index) => ({ id: fixedId(prefix, index + 1), buildingId: building.id, number: String(index + 1) })),
      skipDuplicates: true,
    });

    for (let apartmentNumber = 1; apartmentNumber <= config.apartmentsCount; apartmentNumber += 1) {
      const apartmentId = fixedId(prefix, apartmentNumber);
      const residentsCount = ((buildingNumber * 11 + apartmentNumber * 7) % 4) + 1;
      const apartmentResidents = await prisma.$transaction(async (tx) => {
        const profile = await tx.residentProfile.upsert({
          where: { apartmentId },
          update: { residentsCount, phones: [phoneFor(buildingNumber, apartmentNumber, 0)], phoneVisibility: 'vehicle_lookup', phoneConsentAt: new Date('2026-09-29T08:00:00.000Z') },
          create: { apartmentId, residentsCount, phones: [phoneFor(buildingNumber, apartmentNumber, 0)], phoneVisibility: 'vehicle_lookup', phoneConsentAt: new Date('2026-09-29T08:00:00.000Z') },
        });
        await tx.vehicle.deleteMany({ where: { apartmentId } });
        await tx.residentPerson.deleteMany({ where: { profileId: profile.id } });

        const created: Array<DemoResident & { personId: string }> = [];
        for (let residentNumber = 1; residentNumber <= residentsCount; residentNumber += 1) {
          const fullName = residentName(buildingNumber, apartmentNumber, residentNumber);
          const person = await tx.residentPerson.create({ data: { profileId: profile.id, fullName, phones: [phoneFor(buildingNumber, apartmentNumber, residentNumber)] } });
          const maxUserId = `demo-seed-v2-house-${buildingNumber}-apartment-${apartmentNumber}-resident-${residentNumber}`;
          const user = await tx.user.upsert({ where: { maxUserId }, update: { displayName: fullName }, create: { maxUserId, displayName: fullName } });
          await tx.residentMembership.upsert({
            where: { userId_apartmentId: { userId: user.id, apartmentId } },
            update: { revokedAt: null, verifiedAt: new Date('2026-09-29T08:00:00.000Z') },
            create: { userId: user.id, apartmentId, verifiedAt: new Date('2026-09-29T08:00:00.000Z') },
          });
          created.push({ userId: user.id, apartmentId, apartmentNumber: String(apartmentNumber), fullName, personId: person.id });
        }
        await tx.residentProfile.update({ where: { id: profile.id }, data: { userId: created[0].userId } });

        const carsCount = (buildingNumber * 13 + apartmentNumber * 5) % 3;
        for (let carIndex = 0; carIndex < carsCount; carIndex += 1) {
          const owner = created[carIndex % created.length];
          const plateNumber = buildingNumber * 250 + apartmentNumber * 2 + carIndex;
          await tx.vehicle.create({ data: { apartmentId, userId: owner.userId, ownerPersonId: owner.personId, licensePlate: `А${String(plateNumber).padStart(3, '0')}ВС72` } });
        }
        return created.map(({ personId: _personId, ...resident }) => resident);
      });
      residents.set(`${buildingNumber}:${apartmentNumber}`, apartmentResidents);
    }
  }
  return residents;
}

function residentAt(residents: Map<string, DemoResident[]>, building: number, apartment: number, resident = 0) {
  const people = residents.get(`${building}:${apartment}`);
  if (!people?.length) throw new Error(`Demo resident ${building}:${apartment} is missing`);
  return people[resident % people.length];
}

type DemoIncident = {
  category: 'water' | 'electricity' | 'heating' | 'elevator' | 'leak' | 'cleaning' | 'other';
  locationZone: string; entranceNumber?: number; apartmentNumber?: string; title: string;
  status: 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected'; priority: 'low' | 'normal' | 'high' | 'emergency'; archived?: boolean;
  reports: Array<{ resident: DemoResident; text: string }>; comments: Array<{ resident: DemoResident; text: string }>;
};

async function seedIncident(id: string, buildingId: string, data: DemoIncident) {
  await prisma.$transaction(async (tx) => {
    const archivedAt = data.archived ? new Date('2026-09-28T17:00:00.000Z') : null;
    const resolvedAt = data.status === 'resolved' ? new Date('2026-09-28T17:00:00.000Z') : null;
    const incident = await tx.incident.upsert({
      where: { id },
      update: { category: data.category, locationZone: data.locationZone, entranceNumber: data.entranceNumber ?? null, apartmentNumber: data.apartmentNumber ?? null, title: data.title, status: data.status, priority: data.priority, archivedAt, resolvedAt },
      create: { id, buildingId, category: data.category, locationZone: data.locationZone, entranceNumber: data.entranceNumber, apartmentNumber: data.apartmentNumber, title: data.title, status: data.status, priority: data.priority, archivedAt: archivedAt ?? undefined, resolvedAt: resolvedAt ?? undefined },
    });
    await tx.incidentComment.deleteMany({ where: { incidentId: incident.id } });
    await tx.incidentEvent.deleteMany({ where: { incidentId: incident.id } });
    await tx.incidentSubscription.deleteMany({ where: { incidentId: incident.id } });
    await tx.report.deleteMany({ where: { incidentId: incident.id } });
    for (const [index, report] of data.reports.entries()) {
      await tx.report.create({ data: { incidentId: incident.id, authorUserId: report.resident.userId, apartmentId: report.resident.apartmentId, description: report.text } });
      await tx.incidentSubscription.create({ data: { incidentId: incident.id, userId: report.resident.userId } });
      await tx.incidentEvent.create({ data: { incidentId: incident.id, actorUserId: report.resident.userId, type: index === 0 ? 'incident_created' : 'resident_joined', payload: { description: report.text, demo: true } } });
    }
    for (const comment of data.comments) await tx.incidentComment.create({ data: { incidentId: incident.id, authorUserId: comment.resident.userId, apartmentId: comment.resident.apartmentId, text: comment.text } });
  });
}

async function seedIncidents(residents: Map<string, DemoResident[]>) {
  await prisma.$transaction(async (tx) => {
    await tx.outboxMessage.deleteMany({ where: { incidentId: { in: legacyDemoIncidentIds } } });
    await tx.incidentPhoto.deleteMany({ where: { incidentId: { in: legacyDemoIncidentIds } } });
    await tx.incidentComment.deleteMany({ where: { incidentId: { in: legacyDemoIncidentIds } } });
    await tx.incidentEvent.deleteMany({ where: { incidentId: { in: legacyDemoIncidentIds } } });
    await tx.incidentSubscription.deleteMany({ where: { incidentId: { in: legacyDemoIncidentIds } } });
    await tx.report.deleteMany({ where: { incidentId: { in: legacyDemoIncidentIds } } });
    await tx.incident.deleteMany({ where: { id: { in: legacyDemoIncidentIds } } });
  });
  const first = demoBuildings[0].id;
  const second = demoBuildings[1].id;
  await seedIncident('d5000001-0000-4000-8000-000000000001', first, {
    category: 'water', locationZone: 'entrance', entranceNumber: 1, title: 'Слабый напор холодной воды в подъезде 1', status: 'in_progress', priority: 'high',
    reports: [{ resident: residentAt(residents, 1, 4), text: 'С утра слабый напор холодной воды на этажах 3–5.' }, { resident: residentAt(residents, 1, 18), text: 'Поддерживаю, вода идёт тонкой струёй.' }, { resident: residentAt(residents, 1, 37), text: 'Такая же проблема в нашей квартире.' }],
    comments: [{ resident: residentAt(residents, 1, 18), text: 'Проблема началась примерно в 08:30.' }, { resident: residentAt(residents, 1, 37), text: 'У соседей сверху ситуация такая же.' }],
  });
  await seedIncident('d5000002-0000-4000-8000-000000000002', first, {
    category: 'elevator', locationZone: 'elevator', entranceNumber: 2, title: 'Лифт останавливается между этажами', status: 'new', priority: 'emergency',
    reports: [{ resident: residentAt(residents, 1, 42), text: 'Лифт резко остановился между 5 и 6 этажом, после перезапуска поехал.' }, { resident: residentAt(residents, 1, 59), text: 'Поддерживаю, вечером был сильный рывок.' }],
    comments: [{ resident: residentAt(residents, 1, 42), text: 'В лифте никто не застрял, но пользоваться тревожно.' }],
  });
  await seedIncident('d5000003-0000-4000-8000-000000000003', first, {
    category: 'cleaning', locationZone: 'entrance', entranceNumber: 3, title: 'Не убран подъезд после выходных', status: 'acknowledged', priority: 'normal',
    reports: [{ resident: residentAt(residents, 1, 75), text: 'На первом этаже и лестнице мусор после выходных.' }], comments: [{ resident: residentAt(residents, 1, 79), text: 'Поддерживаю, уборки не было несколько дней.' }],
  });
  await seedIncident('d5000004-0000-4000-8000-000000000004', first, {
    category: 'leak', locationZone: 'apartment', apartmentNumber: '24', title: 'Протечка под кухонной мойкой', status: 'new', priority: 'normal', reports: [{ resident: residentAt(residents, 1, 24), text: 'Капает соединение под кухонной мойкой, перекрыли воду.' }], comments: [],
  });
  await seedIncident('d5000005-0000-4000-8000-000000000005', second, {
    category: 'electricity', locationZone: 'entrance', entranceNumber: 2, title: 'Не работает освещение на лестнице', status: 'in_progress', priority: 'high',
    reports: [{ resident: residentAt(residents, 2, 9), text: 'На лестнице между 6 и 7 этажом нет света.' }, { resident: residentAt(residents, 2, 28), text: 'Поддерживаю, лампы не горят второй день.' }, { resident: residentAt(residents, 2, 44), text: 'Проблема сохраняется вечером.' }], comments: [{ resident: residentAt(residents, 2, 28), text: 'Фонарик в телефоне помогает, но на лестнице небезопасно.' }],
  });
  await seedIncident('d5000006-0000-4000-8000-000000000006', second, {
    category: 'heating', locationZone: 'common', title: 'В первом подъезде прохладные батареи', status: 'resolved', priority: 'normal', archived: true, reports: [{ resident: residentAt(residents, 2, 2), text: 'После запуска отопления батареи почти холодные.' }], comments: [{ resident: residentAt(residents, 2, 12), text: 'После регулировки стало заметно теплее.' }],
  });
  await seedIncident('d5000007-0000-4000-8000-000000000007', second, {
    category: 'other', locationZone: 'yard', title: 'Повреждена скамейка во дворе', status: 'rejected', priority: 'low', archived: true, reports: [{ resident: residentAt(residents, 2, 65), text: 'У детской площадки сломана деревянная планка на скамейке.' }], comments: [],
  });
}

async function seedEmergencyServices() {
  const services = [
    ['70000000-0000-4000-8000-000000000001', 'Тестовый аварийный диспетчер', '+7 (900) 000-00-01', 'Демонстрационные данные. Принимает аварийные обращения по общему имуществу.'],
    ['70000000-0000-4000-8000-000000000002', 'Тестовая водная служба', '+7 (900) 000-00-02', 'Демонстрационные данные. Вопросы водоснабжения и канализации.'],
    ['70000000-0000-4000-8000-000000000003', 'Тестовая лифтовая служба', '+7 (900) 000-00-03', 'Демонстрационные данные. Неисправности лифта и застревание.'],
    ['70000000-0000-4000-8000-000000000004', 'Тестовый электрик', '+7 (900) 000-00-04', 'Демонстрационные данные. Освещение и электроснабжение общих зон.'],
    ['70000000-0000-4000-8000-000000000005', 'Тестовый сантехник', '+7 (900) 000-00-05', 'Демонстрационные данные. Протечки и сантехнические работы.'],
  ] as const;
  for (const [id, name, phone, description] of services) await prisma.emergencyService.upsert({ where: { id }, update: { name, phone, description }, create: { id, name, phone, description } });
}

async function main() {
  const username = process.env.ADMIN_SEED_USERNAME ?? 'dispatcher';
  const password = process.env.ADMIN_SEED_PASSWORD ?? 'change-this-demo-password';
  const passwordHash = await hashAdminPassword(password);
  await prisma.admin.upsert({ where: { username }, update: {}, create: { username, passwordHash, role: 'supervisor' } });
  const residents = await seedApartments();
  await seedIncidents(residents);
  await seedEmergencyServices();
}

main().finally(async () => prisma.$disconnect());
