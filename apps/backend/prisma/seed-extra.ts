// Extra demonstration data: six more test buildings of different size and
// fill level, so lists, paging and grouping by street can be checked.
// Every id is fixed, so running the script again replaces the same rows.
// Run: tsx prisma/seed-extra.ts (or node dist build of it inside the container).
import { PrismaClient, type IncidentCategory, type IncidentStatus } from '@prisma/client';

const prisma = new PrismaClient();

type BuildingPlan = {
  index: number;
  // Test company and a made-up point on the map, see seed.ts.
  companyId: string;
  latitude: number;
  longitude: number;
  street: string;
  house: string;
  apartmentsCount: number;
  entrancesCount: number;
  chatLink: string | null;
  residentApartments: number;
  incidents: IncidentPlan[];
};

type IncidentPlan = {
  title: string;
  category: IncidentCategory;
  zone: 'entrance' | 'elevator' | 'yard' | 'common' | 'apartment';
  status: IncidentStatus;
  supporters: number;
  hoursAgo: number;
  comments?: string[];
  dueInHours?: number;
  rejectionReason?: string;
  publicComment?: string;
};

const plans: BuildingPlan[] = [
  {
    index: 1, companyId: 'c0000000-0000-4000-8000-000000000002', latitude: 56.8352, longitude: 60.6041, street: 'ул. Тестовая Садовая', house: '5', apartmentsCount: 40, entrancesCount: 2, chatLink: null, residentApartments: 12,
    incidents: [
      { title: 'Не закрывается входная дверь в подъезд', category: 'other', zone: 'entrance', status: 'new', supporters: 3, hoursAgo: 3, comments: ['Доводчик сломан, дверь хлопает всю ночь.'] },
      { title: 'Нет горячей воды с утра', category: 'water', zone: 'common', status: 'in_progress', supporters: 5, hoursAgo: 9, dueInHours: 6, publicComment: 'Бригада работает в подвале, подача восстановится к вечеру.' },
      { title: 'Во дворе не вывезен мусор', category: 'cleaning', zone: 'yard', status: 'acknowledged', supporters: 2, hoursAgo: 20 },
      { title: 'Течёт кран на кухне', category: 'leak', zone: 'apartment', status: 'new', supporters: 1, hoursAgo: 1 },
    ],
  },
  {
    index: 2, companyId: 'c0000000-0000-4000-8000-000000000002', latitude: 56.8321, longitude: 60.6087, street: 'ул. Тестовая Садовая', house: '7, корп. 1', apartmentsCount: 60, entrancesCount: 3, chatLink: 'https://max.ru/join/demo-sadovaya-7-1', residentApartments: 20,
    incidents: [
      { title: 'Лифт застревает между 5 и 6 этажом', category: 'elevator', zone: 'elevator', status: 'in_progress', supporters: 7, hoursAgo: 30, dueInHours: 20, comments: ['Сегодня снова застряли с ребёнком.', 'Лифтёр обещал приехать после обеда.'], publicComment: 'Заказана замена блока управления, ориентировочно завтра.' },
      { title: 'Холодные батареи в третьем подъезде', category: 'heating', zone: 'entrance', status: 'acknowledged', supporters: 4, hoursAgo: 48 },
      { title: 'Перегорела лампа на площадке 2 этажа', category: 'electricity', zone: 'entrance', status: 'resolved', supporters: 2, hoursAgo: 120 },
      { title: 'Шум от вентиляции на крыше', category: 'other', zone: 'common', status: 'rejected', supporters: 1, hoursAgo: 200, rejectionReason: 'Оборудование принадлежит магазину на первом этаже, передали обращение владельцу.' },
      { title: 'Протечка с крыши в подъезд после дождя', category: 'leak', zone: 'entrance', status: 'new', supporters: 3, hoursAgo: 5, comments: ['На 9 этаже на полу лужа.'] },
      { title: 'Не работает домофон', category: 'electricity', zone: 'entrance', status: 'resolved', supporters: 6, hoursAgo: 300 },
    ],
  },
  { index: 3, companyId: 'c0000000-0000-4000-8000-000000000002', latitude: 56.8309, longitude: 60.6118, street: 'ул. Тестовая Садовая', house: '7, корп. 2', apartmentsCount: 24, entrancesCount: 1, chatLink: null, residentApartments: 0, incidents: [] },
  {
    index: 4, companyId: 'c0000000-0000-4000-8000-000000000003', latitude: 56.8418, longitude: 60.6559, street: 'пр. Тестовый Мира', house: '12', apartmentsCount: 150, entrancesCount: 6, chatLink: 'https://max.ru/join/demo-mira-12', residentApartments: 35,
    incidents: [
      { title: 'Не работает лифт во втором подъезде', category: 'elevator', zone: 'elevator', status: 'new', supporters: 9, hoursAgo: 2, comments: ['Пожилым соседям с 12 этажа никак не спуститься.'] },
      { title: 'Слабый напор холодной воды на верхних этажах', category: 'water', zone: 'common', status: 'in_progress', supporters: 8, hoursAgo: 26, dueInHours: 30 },
      { title: 'Сломаны качели на детской площадке', category: 'other', zone: 'yard', status: 'acknowledged', supporters: 4, hoursAgo: 72 },
      { title: 'Грязно в лифте и на первом этаже', category: 'cleaning', zone: 'entrance', status: 'new', supporters: 3, hoursAgo: 12 },
      { title: 'Не горит свет у шестого подъезда', category: 'electricity', zone: 'entrance', status: 'new', supporters: 2, hoursAgo: 15 },
      { title: 'Батарея в квартире еле тёплая', category: 'heating', zone: 'apartment', status: 'acknowledged', supporters: 1, hoursAgo: 40 },
      { title: 'Яма с водой у въезда во двор', category: 'other', zone: 'yard', status: 'in_progress', supporters: 5, hoursAgo: 96, dueInHours: 70, publicComment: 'Ремонт асфальта согласован, подрядчик выйдет в течение трёх дней.' },
      { title: 'Протекает труба в подвале', category: 'leak', zone: 'common', status: 'resolved', supporters: 4, hoursAgo: 240 },
    ],
  },
  {
    index: 5, companyId: 'c0000000-0000-4000-8000-000000000001', latitude: 56.8499, longitude: 60.6153, street: 'пер. Тестовый Школьный', house: '3', apartmentsCount: 8, entrancesCount: 1, chatLink: null, residentApartments: 3,
    incidents: [
      { title: 'Скрипит и не закрывается калитка', category: 'other', zone: 'yard', status: 'new', supporters: 2, hoursAgo: 6 },
    ],
  },
  { index: 6, companyId: 'c0000000-0000-4000-8000-000000000002', latitude: 56.8287, longitude: 60.5952, street: 'ул. Тестовая Новая', house: '1', apartmentsCount: 300, entrancesCount: 10, chatLink: null, residentApartments: 0, incidents: [] },
];

const lastNames = ['Смирнов', 'Иванова', 'Кузнецов', 'Попова', 'Соколов', 'Лебедева', 'Козлов', 'Новикова', 'Морозов', 'Петрова', 'Волков', 'Соловьёва', 'Васильев', 'Зайцева', 'Павлов', 'Семёнова', 'Голубев', 'Виноградова', 'Богданов', 'Воробьёва'];
const firstNames = ['Андрей', 'Елена', 'Михаил', 'Ольга', 'Алексей', 'Наталья', 'Сергей', 'Татьяна', 'Дмитрий', 'Ирина', 'Павел', 'Светлана', 'Николай', 'Анна', 'Игорь', 'Юлия', 'Олег', 'Марина', 'Виктор', 'Екатерина'];
const plateLetters = ['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'];

// Deterministic pseudo-random numbers: the same data on every run.
let state = 20261019;
function random() {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
}
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
const id = (kind: number, building: number, value: number) => `de${kind}${building}0000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
const phone = (building: number, apartment: number, person: number) => `+7902${building}${String(apartment).padStart(4, '0')}${person}${building}`;

async function removeBuilding(buildingId: string) {
  const incidents = await prisma.incident.findMany({ where: { buildingId }, select: { id: true } });
  const incidentIds = incidents.map((incident) => incident.id);
  await prisma.$transaction([
    prisma.outboxMessage.deleteMany({ where: { incidentId: { in: incidentIds } } }),
    prisma.incidentPhoto.deleteMany({ where: { incidentId: { in: incidentIds } } }),
    prisma.incidentComment.deleteMany({ where: { incidentId: { in: incidentIds } } }),
    prisma.incidentEvent.deleteMany({ where: { incidentId: { in: incidentIds } } }),
    prisma.incidentSubscription.deleteMany({ where: { incidentId: { in: incidentIds } } }),
    prisma.report.deleteMany({ where: { incidentId: { in: incidentIds } } }),
    prisma.incident.deleteMany({ where: { id: { in: incidentIds } } }),
    prisma.residentMembership.deleteMany({ where: { apartment: { buildingId } } }),
    prisma.vehicle.deleteMany({ where: { apartment: { is: { buildingId } } } }),
    prisma.residentProfile.deleteMany({ where: { apartment: { is: { buildingId } } } }),
    prisma.announcement.deleteMany({ where: { buildingId } }),
    prisma.apartment.deleteMany({ where: { buildingId } }),
    prisma.building.deleteMany({ where: { id: buildingId } }),
  ]);
}

async function seedBuilding(plan: BuildingPlan) {
  const buildingId = id(1, plan.index, 1);
  await removeBuilding(buildingId);
  await prisma.user.deleteMany({ where: { maxUserId: { startsWith: `demo-extra-house-${plan.index}-` } } });

  const address = `${plan.street}, ${plan.house}`;
  await prisma.building.create({
    data: {
      id: buildingId, companyId: plan.companyId, latitude: plan.latitude, longitude: plan.longitude, city: 'Екатеринбург', street: plan.street, house: plan.house, address, apartmentsCount: plan.apartmentsCount,
      entrancesCount: plan.entrancesCount, chatLink: plan.chatLink, accessCode: `200000000${plan.index}`,
    },
  });
  await prisma.apartment.createMany({
    data: Array.from({ length: plan.apartmentsCount }, (_, index) => ({ id: id(2, plan.index, index + 1), buildingId, number: String(index + 1) })),
  });

  // Residents live in apartments spread over the whole building.
  const step = plan.residentApartments ? Math.max(1, Math.floor(plan.apartmentsCount / plan.residentApartments)) : 0;
  const residents: Array<{ userId: string; apartmentId: string; apartmentNumber: number }> = [];
  for (let slot = 0; slot < plan.residentApartments; slot += 1) {
    const apartmentNumber = Math.min(plan.apartmentsCount, 1 + slot * step + Math.floor(random() * Math.max(1, step - 1)));
    const apartmentId = id(2, plan.index, apartmentNumber);
    if (residents.some((resident) => resident.apartmentId === apartmentId)) continue;
    const listed = 1 + Math.floor(random() * 3);
    const living = listed + (random() < 0.3 ? 1 : 0);
    const people = Array.from({ length: listed }, (_, person) => ({ fullName: `${pick(lastNames)} ${pick(firstNames)}`, phones: random() < 0.7 ? [phone(plan.index, apartmentNumber, person + 1)] : [] }));
    const showPhones = random() < 0.6;
    const profile = await prisma.residentProfile.create({
      data: {
        apartmentId, residentsCount: living, phones: [phone(plan.index, apartmentNumber, 0)],
        phoneVisibility: showPhones ? 'vehicle_lookup' : 'hidden', ...(showPhones ? { phoneConsentAt: hoursAgo(500) } : {}),
        people: { create: people },
      },
    });
    const connected = 1 + (random() < 0.35 ? 1 : 0);
    for (let person = 0; person < connected; person += 1) {
      const user = await prisma.user.create({ data: { maxUserId: `demo-extra-house-${plan.index}-apartment-${apartmentNumber}-resident-${person + 1}`, displayName: people[person]?.fullName ?? null } });
      await prisma.residentMembership.create({ data: { userId: user.id, apartmentId, verifiedAt: hoursAgo(400 + person) } });
      if (person === 0) residents.push({ userId: user.id, apartmentId, apartmentNumber });
    }
    if (random() < 0.45) {
      const owner = await prisma.residentPerson.create({ data: { profileId: profile.id, fullName: people[0]!.fullName, phones: people[0]!.phones, isVehicleOwner: true } });
      const plate = `${pick(plateLetters)}${String(100 + plan.index * 100 + apartmentNumber).slice(-3)}${pick(plateLetters)}${pick(plateLetters)}72`;
      const taken = await prisma.vehicle.findUnique({ where: { licensePlate: plate }, select: { id: true } });
      if (!taken) await prisma.vehicle.create({ data: { userId: residents.at(-1)!.userId, apartmentId, licensePlate: plate, ownerPersonId: owner.id } });
    }
  }

  for (const [position, incidentPlan] of plan.incidents.entries()) {
    const supporters = residents.slice(position % Math.max(1, residents.length)).concat(residents).slice(0, Math.min(incidentPlan.supporters, residents.length));
    if (!supporters.length) continue;
    const createdAt = hoursAgo(incidentPlan.hoursAgo);
    const closed = incidentPlan.status === 'resolved' || incidentPlan.status === 'rejected';
    const reporter = supporters[0]!;
    // Reaction of the company varies from 20 minutes to a few hours.
    const reactedAt = new Date(createdAt.getTime() + (20 + ((plan.index * 7 + position * 31) % 9) * 25) * 60 * 1000);
    const incident = await prisma.incident.create({
      data: {
        buildingId, category: incidentPlan.category, locationZone: incidentPlan.zone, title: incidentPlan.title, status: incidentPlan.status, createdAt,
        ...(incidentPlan.zone === 'entrance' || incidentPlan.zone === 'elevator' ? { entranceNumber: 1 + (position % plan.entrancesCount) } : {}),
        ...(incidentPlan.zone === 'apartment' ? { apartmentNumber: String(reporter.apartmentNumber) } : {}),
        ...(incidentPlan.dueInHours ? { dueAt: hoursAgo(-incidentPlan.dueInHours) } : {}),
        ...(incidentPlan.rejectionReason ? { rejectionReason: incidentPlan.rejectionReason } : {}),
        ...(closed ? { archivedAt: hoursAgo(incidentPlan.hoursAgo - 24) } : {}),
        ...(incidentPlan.status === 'resolved' ? { resolvedAt: hoursAgo(incidentPlan.hoursAgo - 24) } : {}),
        ...(incidentPlan.status !== 'new' ? { acknowledgedAt: reactedAt } : {}),
        // Closed work had a deadline too: most of it was met, some was late.
        ...(incidentPlan.status === 'resolved' ? { dueAt: new Date(createdAt.getTime() + ((plan.index + position) % 2 === 0 ? 12 : 48) * 60 * 60 * 1000) } : {}),
      },
    });
    // Apartment incidents are private: only the reporter takes part.
    const participants = incidentPlan.zone === 'apartment' ? [reporter] : supporters;
    for (const [order, participant] of participants.entries()) {
      const at = new Date(createdAt.getTime() + order * 35 * 60 * 1000);
      const description = order === 0 ? incidentPlan.title : 'Поддерживаю, у нас то же самое.';
      await prisma.report.create({ data: { incidentId: incident.id, authorUserId: participant.userId, apartmentId: participant.apartmentId, description, createdAt: at } });
      await prisma.incidentSubscription.create({ data: { incidentId: incident.id, userId: participant.userId, createdAt: at } });
      await prisma.incidentEvent.create({ data: { incidentId: incident.id, actorUserId: participant.userId, type: order === 0 ? 'incident_created' : 'resident_joined', payload: { description }, createdAt: at } });
    }
    for (const [order, text] of (incidentPlan.comments ?? []).entries()) {
      const author = supporters[(order + 1) % supporters.length]!;
      await prisma.incidentComment.create({ data: { incidentId: incident.id, authorUserId: author.userId, apartmentId: author.apartmentId, text, createdAt: new Date(createdAt.getTime() + (order + 1) * 50 * 60 * 1000) } });
    }
    if (incidentPlan.status !== 'new') {
      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id, type: 'incident_updated', createdAt: reactedAt,
          payload: { oldStatus: 'new', newStatus: incidentPlan.status, publicComment: incidentPlan.publicComment ?? null, rejectionReason: incidentPlan.rejectionReason ?? null },
        },
      });
    }
  }
  console.log(`${address}: ${plan.apartmentsCount} квартир, ${residents.length} квартир с жителями, ${plan.incidents.length} заявок по плану`);
}

async function main() {
  for (const plan of plans) await seedBuilding(plan);
  // Keep public incident numbers dense after re-runs.
  await prisma.$executeRawUnsafe(`SELECT setval('incidents_number_seq', (SELECT coalesce(max(number), 0) + 1 FROM incidents), false)`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
