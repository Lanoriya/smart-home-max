import type { Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { blocks, bold } from '../shared/html.js';

// A request nobody answered within a week is no longer shown to anyone; the
// resident can simply send a new one.
export const joinRequestLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export const activeRequestsSince = () => new Date(Date.now() - joinRequestLifetimeMs);

type Tx = Prisma.TransactionClient;

// After moving out a resident must stop receiving updates about requests made
// from the previous apartment. The requests themselves stay for history.
export async function stopOldAddressSubscriptions(tx: Tx, userId: string, apartmentId: string) {
  const result = await tx.incidentSubscription.updateMany({
    where: { userId, enabled: true, incident: { reports: { some: { authorUserId: userId, apartmentId } } } },
    data: { enabled: false },
  });
  return result.count;
}

// Attaches a resident to an apartment: the previous address is released, its
// incident notifications are switched off and an open join request is closed.
export async function bindResident(tx: Tx, userId: string, apartmentId: string) {
  const previous = await tx.residentMembership.findFirst({ where: { userId, revokedAt: null }, orderBy: { verifiedAt: 'desc' }, select: { apartmentId: true } });
  await tx.residentMembership.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await tx.residentMembership.upsert({
    where: { userId_apartmentId: { userId, apartmentId } },
    update: { revokedAt: null, verifiedAt: new Date() },
    create: { userId, apartmentId },
  });
  await tx.botSession.deleteMany({ where: { userId } });
  await tx.apartmentJoinRequest.updateMany({ where: { userId, status: 'pending' }, data: { status: 'cancelled', decidedAt: new Date() } });
  const moved = Boolean(previous && previous.apartmentId !== apartmentId);
  return { previousApartmentId: moved ? previous!.apartmentId : null, stoppedSubscriptions: moved ? await stopOldAddressSubscriptions(tx, userId, previous!.apartmentId) : 0 };
}

export function otherResidentsCount(apartmentId: string, userId: string) {
  return prisma.residentMembership.count({ where: { apartmentId, revokedAt: null, NOT: { userId } } });
}

export function pendingJoinRequest(userId: string) {
  return prisma.apartmentJoinRequest.findFirst({
    where: { userId, status: 'pending', createdAt: { gte: activeRequestsSince() } },
    include: { apartment: { select: { number: true, building: { select: { address: true } } } } },
  });
}

export function requesterName(displayName: string | null | undefined, username?: string | null) {
  return `${displayName?.trim() || 'Пользователь MAX без имени'}${username ? ` (@${username})` : ''}`;
}

// Creates the request and asks every connected resident of the apartment.
export async function createJoinRequest(userId: string, apartmentId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.apartmentJoinRequest.updateMany({ where: { userId, status: 'pending' }, data: { status: 'cancelled', decidedAt: new Date() } });
    const request = await tx.apartmentJoinRequest.create({
      data: { userId, apartmentId },
      include: { user: { select: { displayName: true, maxUsername: true } }, apartment: { select: { number: true, building: { select: { address: true } } } } },
    });
    const residents = await tx.residentMembership.findMany({ where: { apartmentId, revokedAt: null, NOT: { userId } }, distinct: ['userId'], select: { user: { select: { maxUserId: true } } } });
    const name = requesterName(request.user.displayName, request.user.maxUsername);
    const text = blocks(
      [bold(`Запрос на подключение к квартире ${request.apartment.number}`), `${request.apartment.building.address}, кв. ${request.apartment.number}`],
      [`${name} хочет подключиться к вашей квартире в боте.`],
      ['Если это член семьи или сосед по квартире — примите. Если вы не знаете, кто это, — отклоните: без подтверждения человек не увидит данные квартиры и её заявки.'],
    ).value;
    const buttons = [[
      { text: 'Принять', payload: `join:approve:${request.id}`, intent: 'positive' as const },
      { text: 'Отклонить', payload: `join:reject:${request.id}`, intent: 'negative' as const },
    ]];
    await tx.outboxMessage.createMany({ data: residents.map(({ user }) => ({ type: 'join_request', payload: { userId: user.maxUserId, text, format: 'html', buttons } })) });
    return { request, notified: residents.length };
  });
}

export async function cancelJoinRequest(userId: string) {
  const result = await prisma.apartmentJoinRequest.updateMany({ where: { userId, status: 'pending' }, data: { status: 'cancelled', decidedAt: new Date() } });
  return result.count > 0;
}

export type JoinDecision = 'approve' | 'reject';
export type JoinActor = { userId: string } | { adminId: string };
export type DecisionResult =
  | { ok: true; status: 'approved' | 'rejected'; requesterName: string; apartmentNumber: string; address: string }
  | { ok: false; reason: 'not_found' | 'already_decided' | 'expired' | 'not_allowed' };

// The first answer wins: later presses of the same buttons see that the
// request is already decided. The requester learns the result from the bot.
export async function decideJoinRequest(requestId: string, decision: JoinDecision, actor: JoinActor): Promise<DecisionResult> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.apartmentJoinRequest.findUnique({
      where: { id: requestId },
      include: { user: { select: { maxUserId: true, displayName: true, maxUsername: true } }, apartment: { select: { number: true, building: { select: { address: true } } } } },
    });
    if (!request) return { ok: false, reason: 'not_found' } as const;
    if (request.status !== 'pending') return { ok: false, reason: 'already_decided' } as const;
    if ('userId' in actor) {
      const member = await tx.residentMembership.findFirst({ where: { userId: actor.userId, apartmentId: request.apartmentId, revokedAt: null }, select: { id: true } });
      if (!member) return { ok: false, reason: 'not_allowed' } as const;
    }
    if (request.createdAt < activeRequestsSince()) {
      await tx.apartmentJoinRequest.update({ where: { id: request.id }, data: { status: 'cancelled', decidedAt: new Date() } });
      return { ok: false, reason: 'expired' } as const;
    }

    const status = decision === 'approve' ? 'approved' as const : 'rejected' as const;
    // A conditional update: if two residents press at the same moment only
    // one of them changes the pending request.
    const changed = await tx.apartmentJoinRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: { status, decidedAt: new Date(), ...('userId' in actor ? { decidedByUserId: actor.userId } : { decidedByAdminId: actor.adminId }) },
    });
    if (!changed.count) return { ok: false, reason: 'already_decided' } as const;

    const address = `${request.apartment.building.address}, кв. ${request.apartment.number}`;
    if (status === 'approved') {
      await bindResident(tx, request.userId, request.apartmentId);
      await tx.outboxMessage.create({ data: { type: 'join_result', payload: {
        userId: request.user.maxUserId, format: 'html',
        text: blocks([bold('Подключение подтверждено')], [address], ['Теперь вам доступны заявки дома, объявления УК и данные квартиры.']).value,
        buttons: [[{ text: 'Открыть главное меню', payload: 'menu:main' }]],
      } } });
    } else {
      await tx.outboxMessage.create({ data: { type: 'join_result', payload: {
        userId: request.user.maxUserId, format: 'html',
        text: blocks([bold('Запрос на подключение отклонён')], [address], ['Если вы выбрали квартиру по ошибке, выберите свою. Если это ваша квартира, обратитесь в управляющую компанию.']).value,
        buttons: [[{ text: 'Выбрать другой адрес', payload: 'apartment:change:confirm' }], [{ text: 'Контакты УК', payload: 'uk:contacts' }]],
      } } });
    }
    return { ok: true, status, requesterName: requesterName(request.user.displayName, request.user.maxUsername), apartmentNumber: request.apartment.number, address };
  });
}

// A resident leaves their apartment, in the bot or in the app. The consent to
// the processing of personal data is withdrawn with it: the shared phone and
// the cars are erased, notifications of the old address stop. Incidents stay
// in the history of the company.
export async function leaveApartment(tx: Tx, userId: string, apartmentId: string) {
  await tx.apartmentLeave.create({ data: { userId } });
  await tx.residentMembership.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await tx.botSession.deleteMany({ where: { userId } });
  // The cars the resident added go, and with them the owner records made for
  // those cars (a name and a phone), unless another car still uses them.
  const cars = await tx.vehicle.findMany({ where: { userId }, select: { ownerPersonId: true } });
  await tx.vehicle.deleteMany({ where: { userId } });
  const owners = cars.map((car) => car.ownerPersonId).filter((id): id is string => Boolean(id));
  if (owners.length) await tx.residentPerson.deleteMany({ where: { id: { in: owners }, isVehicleOwner: true, vehicles: { none: {} } } });
  await tx.user.update({ where: { id: userId }, data: { consentAt: null, sharedPhone: null, phoneSharedAt: null } });
  return { stoppedSubscriptions: await stopOldAddressSubscriptions(tx, userId, apartmentId) };
}
