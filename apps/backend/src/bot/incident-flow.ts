import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import type { IncidentCategory } from '@prisma/client';
import type { CallbackButton, ImageAttachment, Messenger } from './messenger.js';
import { prisma } from '../shared/prisma.js';
import { env } from '../config/env.js';
import { inviteCodeMatches } from '../users/invite-code.js';
import {
  categoryLabels,
  categoryValues,
  createIncidentFromReport,
  findMatchingIncidents,
  joinIncident,
  joinPublicIncident,
  cancelResidentReport,
  addIncidentPhotos,
} from '../incidents/incident-service.js';

const sessionDataSchema = z.object({
  apartmentId: z.string().uuid().optional(),
  buildingId: z.string().uuid().optional(),
  apartmentNumber: z.string().optional(),
  recipientApartmentId: z.string().uuid().optional(),
  recipientApartmentNumber: z.string().optional(),
  entrancesCount: z.number().int().min(1).max(20).optional(),
  category: z.enum(categoryValues as [IncidentCategory, ...IncidentCategory[]]).optional(),
  locationZone: z.string().optional(),
  entranceNumber: z.number().int().min(1).max(20).optional(),
  affectedApartmentNumber: z.string().trim().min(1).max(20).optional(),
  description: z.string().optional(),
  photos: z.array(z.object({ token: z.string(), url: z.string().optional() })).max(3).optional(),
  incidentId: z.string().uuid().optional(),
  problemScope: z.enum(['building', 'apartment']).optional(),
  phoneVisibility: z.enum(['hidden', 'vehicle_lookup']).optional(),
  ukAttempts: z.number().int().min(0).max(5).optional(),
  apartmentCodeAttempts: z.number().int().min(0).max(5).optional(),
});

type SessionData = z.infer<typeof sessionDataSchema>;

const zoneLabels: Record<string, string> = {
  entrance: 'Подъезд',
  elevator: 'Лифт',
  yard: 'Двор',
  common: 'Другое',
  apartment: 'Квартира',
};

const statusLabels = {
  new: 'Новая',
  acknowledged: 'Принята',
  in_progress: 'В работе',
  resolved: 'Устранена',
  rejected: 'Отклонена',
} as const;

const apartmentCategoryValues: IncidentCategory[] = ['water', 'electricity', 'heating', 'leak', 'other'];

export class IncidentFlow {
  constructor(private readonly messenger: Messenger) {}

  async start(maxUserId: string): Promise<void> {
    const user = await this.ensureUser(maxUserId);
    const membership = await this.getMembership(user.id);
    if (!membership) {
      await this.askApartmentCode(maxUserId, user.id);
      return;
    }
    await prisma.botSession.deleteMany({ where: { userId: user.id } });
    await this.showMainMenu(maxUserId, `Квартира ${membership.apartment.number} подтверждена.`);
  }

  async begin(maxUserId: string): Promise<void> {
    const user = await this.ensureUser(maxUserId);
    const membership = await this.getMembership(user.id);

    if (!membership) {
      await this.askApartmentCode(maxUserId, user.id);
      return;
    }

    await this.askProblemScope(maxUserId, user.id, {
      apartmentId: membership.apartmentId,
      buildingId: membership.apartment.buildingId,
      apartmentNumber: membership.apartment.number,
      entrancesCount: membership.apartment.building.entrancesCount,
    });
  }

  async handleText(maxUserId: string, text: string, images: ImageAttachment[] = []): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { maxUserId } });
    if (!user) return false;
    const session = await prisma.botSession.findUnique({ where: { userId: user.id } });
    if (!session || session.expiresAt < new Date()) return false;
    const data = sessionDataSchema.parse(session.data);

    if (session.step === 'add_photo') {
      if (!images.length || !data.incidentId) {
        await this.messenger.sendMessageToUser(maxUserId, 'Пришлите изображение одним сообщением. Можно добавить до 3 фото от одного жителя.');
        return true;
      }
      try {
        await addIncidentPhotos(user.id, data.incidentId, images);
        await prisma.botSession.delete({ where: { userId: user.id } });
        await this.messenger.sendMessageToUser(maxUserId, 'Фото добавлено к заявке.', mainMenuLinkButtons());
      } catch {
        await this.messenger.sendMessageToUser(maxUserId, 'Не удалось добавить фото: максимум 3 от одного жителя и 9 на заявку.');
      }
      return true;
    }
    if (session.step === 'incident_comment') {
      const comment = text.trim();
      if (!data.incidentId || comment.length < 2 || comment.length > 1000) {
        await this.messenger.sendMessageToUser(maxUserId, 'Комментарий должен быть от 2 до 1000 символов.');
        return true;
      }
      const membership = await this.getMembership(user.id);
      const incident = membership && await prisma.incident.findFirst({
        where: {
          id: data.incidentId,
          buildingId: membership.apartment.buildingId,
          locationZone: { not: 'apartment' },
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!incident) {
        await prisma.botSession.deleteMany({ where: { userId: user.id } });
        await this.messenger.sendMessageToUser(maxUserId, 'Заявка больше недоступна для обсуждения.', mainMenuLinkButtons());
        return true;
      }
      await prisma.incidentComment.create({ data: { incidentId: incident.id, authorUserId: user.id, apartmentId: membership.apartmentId, text: comment } });
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.messenger.sendMessageToUser(maxUserId, 'Комментарий добавлен. Его увидят жители вашего дома.', [[{ text: 'К общим заявкам дома', payload: 'incidents:general' }], [{ text: 'В главное меню', payload: 'menu:main' }]]);
      return true;
    }
    if (session.step === 'resident_message_apartment') {
      const apartmentNumber = text.trim();
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      if (!/^\d{1,10}[а-яА-Яa-zA-Z]?$/.test(apartmentNumber)) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите номер квартиры, например: 45.');
        return true;
      }
      const apartment = await prisma.apartment.findUnique({ where: { buildingId_number: { buildingId: membership.apartment.buildingId, number: apartmentNumber } }, select: { id: true, number: true, _count: { select: { memberships: { where: { revokedAt: null } } } } } });
      if (!apartment || apartment.id === membership.apartmentId || apartment._count.memberships === 0) {
        await this.messenger.sendMessageToUser(maxUserId, 'В этой квартире нет доступных получателей. Укажите другую квартиру вашего дома.');
        return true;
      }
      await this.askApartmentMessageText(maxUserId, user.id, { recipientApartmentId: apartment.id, recipientApartmentNumber: apartment.number });
      return true;
    }
    if (session.step === 'resident_message_text') {
      const message = text.trim();
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      if (!data.recipientApartmentId || !data.recipientApartmentNumber || message.length < 2 || message.length > 1000) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите сообщение от 2 до 1000 символов.');
        return true;
      }
      const recipients = await prisma.residentMembership.findMany({ where: { apartmentId: data.recipientApartmentId, revokedAt: null }, distinct: ['userId'], select: { user: { select: { maxUserId: true } } } });
      if (!recipients.length) {
        await prisma.botSession.deleteMany({ where: { userId: user.id } });
        await this.messenger.sendMessageToUser(maxUserId, 'У этой квартиры больше нет доступных получателей.', mainMenuLinkButtons());
        return true;
      }
      const buttons: CallbackButton[][] = [[{ text: 'Ответить квартире', payload: `resident:reply:${membership.apartmentId}`, intent: 'positive' }], [{ text: 'Отмена', payload: 'menu:main', intent: 'negative' }]];
      await prisma.outboxMessage.createMany({ data: recipients.map(({ user: recipient }) => ({ type: 'resident_message', payload: { userId: recipient.maxUserId, text: `Квартира ${membership.apartment.number} пишет вам: «${message}»`, buttons } })) });
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.messenger.sendMessageToUser(maxUserId, `Сообщение отправлено квартире ${data.recipientApartmentNumber}.`, mainMenuLinkButtons());
      return true;
    }
    if (session.step === 'new_photos') {
      if (!images.length) { await this.messenger.sendMessageToUser(maxUserId, 'Пришлите фото одним сообщением или нажмите «Отправить заявку».'); return true; }
      const photos = [...(data.photos ?? []), ...images].slice(0, 3);
      await this.saveSession(user.id, 'ready_submit', { ...data, photos });
      await this.messenger.sendMessageToUser(maxUserId, `Фото добавлено (${photos.length}/3). Можно добавить ещё или отправить заявку.`, [
        [{ text: 'Добавить ещё фото', payload: 'incident:new-photo' }],
        [{ text: 'Отправить заявку', payload: 'incident:submit', intent: 'positive' }],
        [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
      ]);
      return true;
    }

    if (session.step === 'profile_residents') {
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      const residentsCount = Number(text.trim());
      if (!Number.isInteger(residentsCount) || residentsCount < 1 || residentsCount > 20) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите количество жильцов числом от 1 до 20.');
        return true;
      }
      await prisma.residentProfile.upsert({ where: { apartmentId: membership.apartmentId }, update: { residentsCount }, create: { apartmentId: membership.apartmentId, residentsCount } });
      await this.showProfile(maxUserId, user.id);
      return true;
    }
    if (session.step === 'profile_phone') {
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      const phones = extractPhones(text);
      if (!phones.length) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите один или несколько номеров через запятую, например 8 900 123-45-67.');
        return true;
      }
      await prisma.residentProfile.upsert({
        where: { apartmentId: membership.apartmentId },
        update: { phones, phoneConsentAt: null, phoneVisibility: 'hidden' },
        create: { apartmentId: membership.apartmentId, phones, phoneVisibility: 'hidden' },
      });
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.messenger.sendMessageToUser(maxUserId, 'Телефоны сохранены в профиле квартиры. Разрешить показывать их жителям подключённых домов при поиске автомобиля? Добавляйте только номера, на публикацию которых получено согласие владельца.', [
        [{ text: 'Разрешить показ', payload: 'profile:phone-consent:yes', intent: 'positive' }],
        [{ text: 'Оставить скрытыми', payload: 'profile:phone-consent:no' }],
        [{ text: 'В главное меню', payload: 'menu:main' }],
      ]);
      return true;
    }
    if (session.step === 'profile_people') {
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      const people = text.split(/\n+/).map((line) => ({ fullName: removePhones(line).replace(/[|,;]+/g, ' ').trim(), phones: extractPhones(line) })).filter((person) => person.fullName.length >= 3).slice(0, 10);
      if (!people.length) { await this.messenger.sendMessageToUser(maxUserId, 'Введите ФИО по одному на строку. После ФИО можно указать телефон.'); return true; }
      await prisma.$transaction(async (tx) => {
        const profile = await tx.residentProfile.upsert({ where: { apartmentId: membership.apartmentId }, update: {}, create: { apartmentId: membership.apartmentId } });
        await tx.residentPerson.deleteMany({ where: { profileId: profile.id, isVehicleOwner: false } });
        await tx.residentPerson.createMany({ data: people.map((person) => ({ profileId: profile.id, ...person })) });
      });
      await this.showProfile(maxUserId, user.id);
      return true;
    }
    if (session.step === 'profile_cars') {
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      const cars = text.split(/\n+/).map((line) => {
        const plateText = line.trim().split(/[\s|]+/)[0] ?? '';
        const details = line.trim().slice(plateText.length);
        return { licensePlate: normalizePlate(plateText), fullName: removePhones(details).replace(/[|,;]+/g, ' ').trim(), phones: extractPhones(details) };
      }).filter((car) => car.licensePlate).slice(0, 5);
      if (!cars.length) { await this.messenger.sendMessageToUser(maxUserId, 'Введите номер машины, например А123ВС.'); return true; }
      const result = await prisma.$transaction(async (tx) => {
        const profile = await tx.residentProfile.upsert({
          where: { apartmentId: membership.apartmentId },
          update: {},
          create: { apartmentId: membership.apartmentId },
        });
        let saved = 0;
        let belongsToAnotherApartment = 0;
        for (const car of cars) {
          const existing = await tx.vehicle.findUnique({ where: { licensePlate: car.licensePlate }, select: { id: true, apartmentId: true, ownerPersonId: true } });
          if (existing && existing.apartmentId !== membership.apartmentId) { belongsToAnotherApartment += 1; continue; }
          if (existing) {
            if (car.fullName) {
              const owner = existing.ownerPersonId
                ? await tx.residentPerson.update({ where: { id: existing.ownerPersonId }, data: { fullName: car.fullName, phones: car.phones, isVehicleOwner: true } })
                : await tx.residentPerson.create({ data: { profileId: profile.id, fullName: car.fullName, phones: car.phones, isVehicleOwner: true } });
              await tx.vehicle.update({ where: { id: existing.id }, data: { ownerPersonId: owner.id } });
            }
          } else {
            const owner = car.fullName ? await tx.residentPerson.create({ data: { profileId: profile.id, fullName: car.fullName, phones: car.phones, isVehicleOwner: true } }) : null;
            await tx.vehicle.create({ data: { userId: user.id, apartmentId: membership.apartmentId, licensePlate: car.licensePlate, ...(owner ? { ownerPersonId: owner.id } : {}) } });
          }
          saved += 1;
        }
        return { saved, belongsToAnotherApartment };
      });
      if (!result.saved) {
        await this.messenger.sendMessageToUser(maxUserId, 'Не удалось сохранить авто: этот госномер уже привязан к другой квартире.', [[{ text: 'К моей квартире', payload: 'profile:view' }]]);
        return true;
      }
      await this.messenger.sendMessageToUser(maxUserId, `Информация сохранена: ${result.saved === 1 ? '1 автомобиль' : `${result.saved} автомобиля`}${result.belongsToAnotherApartment ? `. Не сохранено: ${result.belongsToAnotherApartment} — номер уже привязан к другой квартире` : ''}. Телефоны владельцев останутся скрытыми, пока вы явно не разрешите их показ в настройке «Видимость телефонов».`);
      await this.showProfile(maxUserId, user.id);
      return true;
    }
    if (session.step === 'car_search') {
      const licensePlate = normalizePlate(text);
      const basePlate = plateBase(licensePlate);
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      const vehicles = await prisma.vehicle.findMany({
        where: { licensePlate: licensePlate === basePlate ? { startsWith: basePlate } : licensePlate },
        include: { owner: true, apartment: { include: { profile: true, building: { select: { address: true } } } } },
        orderBy: { licensePlate: 'asc' },
        take: 10,
      });
      const matches = vehicles.flatMap((vehicle) => {
        if (!vehicle.apartment) return [];
        const profile = vehicle.apartment.profile;
        const phones = profile?.phoneConsentAt && profile.phoneVisibility === 'vehicle_lookup'
          ? (vehicle.owner?.phones.length ? vehicle.owner.phones : profile.phones)
          : [];
        return phones.length ? [{ vehicle, phones }] : [];
      });
      if (!matches.length) {
        await this.messenger.sendMessageToUser(maxUserId, 'Машина не найдена либо владелец не добавил номер телефона.', mainMenuLinkButtons());
      } else {
        const heading = matches.length > 1 ? `Найдено автомобилей: ${matches.length}\n\n` : '';
        const details = matches.map(({ vehicle, phones }) => `Машина ${vehicle.licensePlate}\nВладелец: ${vehicle.owner?.fullName ?? 'не указан'}\nКвартира: ${vehicle.apartment!.number}\nДом: ${vehicle.apartment!.building.address}\nТелефон: ${phones.join(', ')}`).join('\n\n');
        await this.messenger.sendMessageToUser(maxUserId, `${heading}${details}\n\nПоиск доступен среди всех подключённых домов.`, mainMenuLinkButtons());
      }
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      return true;
    }

    if (session.step === 'apartment_number') {
      const apartmentNumber = text.trim();
      if (!/^\d{1,10}$/.test(apartmentNumber) || !data.buildingId) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите номер квартиры цифрами, например: 45.');
        return true;
      }
      const apartment = await prisma.apartment.findUnique({
        where: { buildingId_number: { buildingId: data.buildingId, number: apartmentNumber } },
        include: { building: { select: { entrancesCount: true, apartmentsCount: true } } },
      });
      if (!apartment || Number(apartmentNumber) > apartment.building.apartmentsCount) {
        await this.messenger.sendMessageToUser(maxUserId, 'Квартира не найдена в выбранном доме. Проверьте номер.');
        return true;
      }
      await this.saveSession(user.id, 'uk_code', {
        apartmentId: apartment.id,
        buildingId: apartment.buildingId,
        apartmentNumber: apartment.number,
        entrancesCount: apartment.building.entrancesCount,
      });
      await this.messenger.sendMessageToUser(maxUserId, 'Введите десятизначный код, выданный вашей управляющей компанией.', flowButtons());
      return true;
    }

    if (session.step === 'uk_code') {
      if (!data.apartmentId || !await verifyUkCode(text.trim())) {
        const ukAttempts = (data.ukAttempts ?? 0) + 1;
        if (ukAttempts >= 5) {
          await prisma.botSession.deleteMany({ where: { userId: user.id } });
          await this.messenger.sendMessageToUser(maxUserId, 'Слишком много неверных попыток. Начните привязку квартиры заново и уточните код в управляющей компании.');
          await this.askApartmentCode(maxUserId, user.id);
          return true;
        }
        await this.saveSession(user.id, 'uk_code', { ...data, ukAttempts });
        await this.messenger.sendMessageToUser(maxUserId, 'Код не подошёл. Проверьте его у управляющей компании и попробуйте ещё раз.');
        return true;
      }
      const apartment = await prisma.apartment.findUnique({ where: { id: data.apartmentId }, select: { inviteCodeHash: true } });
      if (apartment?.inviteCodeHash) {
        await this.saveSession(user.id, 'apartment_code', data);
        await this.messenger.sendMessageToUser(maxUserId, 'Введите индивидуальный код квартиры, выданный управляющей компанией.', flowButtons());
        return true;
      }
      await this.confirmApartmentMembership(maxUserId, user.id, data.apartmentId, data.apartmentNumber);
      return true;
    }

    if (session.step === 'apartment_code') {
      const apartment = data.apartmentId
        ? await prisma.apartment.findUnique({ where: { id: data.apartmentId }, select: { inviteCodeHash: true } })
        : null;
      if (!data.apartmentId || !apartment?.inviteCodeHash || !inviteCodeMatches(text, apartment.inviteCodeHash, env.APARTMENT_CODE_PEPPER)) {
        const attempts = (data.apartmentCodeAttempts ?? 0) + 1;
        if (attempts >= 5) {
          await prisma.botSession.deleteMany({ where: { userId: user.id } });
          await this.messenger.sendMessageToUser(maxUserId, 'Слишком много неверных попыток. Начните привязку квартиры заново и уточните индивидуальный код в управляющей компании.');
          await this.askApartmentCode(maxUserId, user.id);
          return true;
        }
        await this.saveSession(user.id, 'apartment_code', { ...data, apartmentCodeAttempts: attempts });
        await this.messenger.sendMessageToUser(maxUserId, 'Индивидуальный код не подошёл. Проверьте его и попробуйте ещё раз.');
        return true;
      }
      await this.confirmApartmentMembership(maxUserId, user.id, data.apartmentId, data.apartmentNumber);
      return true;
    }

    if (session.step === 'description') {
      const description = text.trim();
      if (!description && images.length) {
        await this.saveSession(user.id, 'description', { ...data, photos: [...(data.photos ?? []), ...images].slice(0, 3) });
        await this.messenger.sendMessageToUser(maxUserId, 'Фото сохранено. Теперь опишите проблему текстом.');
        return true;
      }
      if (description.length < 5 || description.length > 500) {
        await this.messenger.sendMessageToUser(maxUserId, 'Опишите проблему текстом от 5 до 500 символов.');
        return true;
      }
      const complete = requireDraft({ ...data, description, photos: [...(data.photos ?? []), ...images].slice(0, 3) });
      await this.saveSession(user.id, 'ready_submit', complete);
      await this.messenger.sendMessageToUser(maxUserId, 'Описание принято. Теперь можете добавить фото или отправить заявку без фото.', [
        [{ text: 'Добавить фото', payload: 'incident:new-photo' }],
        [{ text: 'Отправить без фото', payload: 'incident:submit', intent: 'positive' }],
        [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
      ]);
      return true;
    }


    if (session.step === 'affected_apartment') {
      const apartmentNumber = text.trim();
      if (!/^\d{1,10}[а-яА-Яa-zA-Z]?$/.test(apartmentNumber)) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите номер квартиры, например: 45.');
        return true;
      }
      await this.askDescription(maxUserId, user.id, { ...data, affectedApartmentNumber: apartmentNumber });
      return true;
    }

    return false;
  }

  async handleCallback(maxUserId: string, payload: string): Promise<boolean> {
    if (payload === 'incident:create') {
      await this.begin(maxUserId);
      return true;
    }
    const user = await prisma.user.findUnique({ where: { maxUserId } });
    if (!user) return false;

    if (payload === 'menu:main') {
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.showMainMenu(maxUserId);
      return true;
    }
    if (payload === 'incidents:list') {
      await this.showMyIncidents(maxUserId, user.id, false);
      return true;
    }
    if (payload === 'incidents:archive') {
      await this.showMyIncidents(maxUserId, user.id, true);
      return true;
    }
    if (payload === 'incidents:general') {
      await this.showGeneralIncidents(maxUserId, user.id);
      return true;
    }
    if (payload === 'bot:info') {
      await this.showBotInfo(maxUserId);
      return true;
    }
    if (payload === 'emergency:services') {
      await this.showEmergencyServices(maxUserId);
      return true;
    }
    if (payload === 'profile:view') { await this.showProfile(maxUserId, user.id); return true; }
    if (payload === 'resident:message') {
      await this.saveSession(user.id, 'resident_message_apartment', {});
      await this.messenger.sendMessageToUser(maxUserId, 'Введите номер квартиры получателя в вашем доме.', flowButtons());
      return true;
    }
    if (payload.startsWith('resident:reply:')) {
      const apartmentId = payload.slice('resident:reply:'.length);
      if (!z.string().uuid().safeParse(apartmentId).success) return false;
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      const apartment = await prisma.apartment.findFirst({ where: { id: apartmentId, buildingId: membership.apartment.buildingId, memberships: { some: { revokedAt: null } } }, select: { id: true, number: true } });
      if (!apartment || apartment.id === membership.apartmentId) { await this.messenger.sendMessageToUser(maxUserId, 'Этой квартире сейчас нельзя отправить ответ.', mainMenuLinkButtons()); return true; }
      await this.askApartmentMessageText(maxUserId, user.id, { recipientApartmentId: apartment.id, recipientApartmentNumber: apartment.number }, `Напишите ответ квартире ${apartment.number}.`);
      return true;
    }
    if (payload === 'apartment:leave') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      const leavesToday = await prisma.apartmentLeave.count({ where: { userId: user.id, createdAt: { gte: startOfYekaterinburgDay() } } });
      const remaining = Math.max(0, 2 - leavesToday);
      if (!remaining) { await this.messenger.sendMessageToUser(maxUserId, 'Сегодня лимит удаления из квартиры исчерпан: доступно не более двух удалений в день. Попробуйте завтра.', mainMenuLinkButtons()); return true; }
      await this.messenger.sendMessageToUser(maxUserId, `Удалить привязку к квартире ${membership.apartment.number}? Вы останетесь в боте, но заявки и профиль квартиры будут недоступны до новой привязки.\n\nОграничение: удалиться из квартиры можно не более 2 раз в день. Сегодня после этого действия останется попыток: ${remaining - 1}.`, [
        [{ text: 'Удалиться из квартиры', payload: 'apartment:leave:confirm', intent: 'negative' }],
        [{ text: 'Отмена', payload: 'menu:main' }],
      ]);
      return true;
    }
    if (payload === 'apartment:leave:confirm') {
      const removed = await prisma.$transaction(async (tx) => {
        const leavesToday = await tx.apartmentLeave.count({ where: { userId: user.id, createdAt: { gte: startOfYekaterinburgDay() } } });
        if (leavesToday >= 2) return false;
        await tx.apartmentLeave.create({ data: { userId: user.id } });
        await tx.residentMembership.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.botSession.deleteMany({ where: { userId: user.id } });
        return true;
      });
      if (!removed) { await this.messenger.sendMessageToUser(maxUserId, 'Сегодня лимит удаления из квартиры исчерпан. Попробуйте завтра.', mainMenuLinkButtons()); return true; }
      await this.messenger.sendMessageToUser(maxUserId, 'Привязка к квартире удалена. Чтобы снова пользоваться заявками, выберите дом и подтвердите квартиру.', [[{ text: 'Выбрать квартиру', payload: 'apartment:change', intent: 'positive' }]]);
      return true;
    }
    if (payload === 'car:search') {
      await this.saveSession(user.id, 'car_search', {});
      await this.messenger.sendMessageToUser(maxUserId, 'Введите номер машины, например А123ВС.', flowButtons());
      return true;
    }
    if (payload === 'profile:phone') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      await this.saveSession(user.id, 'profile_phone', {});
      await this.messenger.sendMessageToUser(maxUserId, 'Введите телефоны в любом привычном формате: каждый номер с новой строки или через запятую. Сохраню их как +79000000000. После этого отдельно спрошу, можно ли показывать номер при «Узнать чье авто».', flowButtons());
      return true;
    }
    if (payload === 'profile:phone-consent:yes') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      const profile = await prisma.residentProfile.upsert({
        where: { apartmentId: membership.apartmentId },
        update: { phoneConsentAt: new Date(), phoneVisibility: 'vehicle_lookup' },
        create: { apartmentId: membership.apartmentId, phoneConsentAt: new Date(), phoneVisibility: 'vehicle_lookup' },
      });
      if (!profile.phones.length) {
        await this.saveSession(user.id, 'profile_phone', {});
        await this.messenger.sendMessageToUser(maxUserId, 'Введите телефоны через запятую или каждый с новой строки. Сохраню их как +79000000000.', flowButtons());
      } else {
        await this.showProfile(maxUserId, user.id);
      }
      return true;
    }
    if (payload === 'profile:phone-consent:no') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      await prisma.residentProfile.updateMany({ where: { apartmentId: membership.apartmentId }, data: { phoneConsentAt: null, phoneVisibility: 'hidden' } });
      await this.showProfile(maxUserId, user.id);
      return true;
    }
    if (payload === 'profile:visibility') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      await prisma.residentProfile.upsert({
        where: { apartmentId: membership.apartmentId },
        update: { phoneVisibility: 'vehicle_lookup', phoneConsentAt: new Date() },
        create: { apartmentId: membership.apartmentId, phoneVisibility: 'vehicle_lookup', phoneConsentAt: new Date() },
      });
      await this.showProfile(maxUserId, user.id);
      return true;
    }
    if (payload === 'profile:visibility:hidden' || payload === 'profile:visibility:vehicle_lookup') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      const phoneVisibility = payload.endsWith('vehicle_lookup') ? 'vehicle_lookup' : 'hidden';
      await prisma.residentProfile.upsert({
        where: { apartmentId: membership.apartmentId },
        update: { phoneVisibility, phoneConsentAt: phoneVisibility === 'vehicle_lookup' ? new Date() : null },
        create: { apartmentId: membership.apartmentId, phoneVisibility, ...(phoneVisibility === 'vehicle_lookup' ? { phoneConsentAt: new Date() } : {}) },
      });
      await this.showProfile(maxUserId, user.id);
      return true;
    }
    if (payload === 'profile:residents' || payload === 'profile:people' || payload === 'profile:cars') {
      const step = payload === 'profile:residents' ? 'profile_residents' : payload === 'profile:people' ? 'profile_people' : 'profile_cars';
      await this.saveSession(user.id, step, {});
      const prompt = step === 'profile_residents' ? 'Сколько человек живёт в вашей квартире?' : step === 'profile_people' ? 'Введите ФИО по одному на строку. После пробела можно указать телефон в любом привычном формате.\nПример: Иванов Иван Иванович 79000000000' : 'Введите по одной машине на строку: номер, имя владельца и телефон. Можно ввести несколько строк — каждая добавится или обновится по госномеру. Достаточно указать только имя владельца.\nПример:\nА123ВС Иван 79000000000\nВ615СВ Дарья +79401823445';
      await this.messenger.sendMessageToUser(maxUserId, prompt, flowButtons());
      return true;
    }
    if (payload === 'apartment:change') {
      await this.askApartmentCode(maxUserId, user.id);
      return true;
    }
    if (payload.startsWith('building:choose:')) {
      const buildingId = payload.slice('building:choose:'.length);
      if (!z.string().uuid().safeParse(buildingId).success) return false;
      const building = await prisma.building.findUnique({ where: { id: buildingId }, select: { id: true, address: true } });
      if (!building) return false;
      await this.saveSession(user.id, 'apartment_number', { buildingId: building.id });
      await this.messenger.sendMessageToUser(maxUserId, `${building.address}\nВведите номер своей квартиры цифрами.` , flowButtons());
      return true;
    }
    if (payload.startsWith('incident:view:')) {
      const incidentId = payload.slice('incident:view:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      await this.showIncident(maxUserId, user.id, incidentId);
      return true;
    }
    if (payload.startsWith('incident:comment:')) {
      const incidentId = payload.slice('incident:comment:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      const membership = await this.getMembership(user.id);
      const incident = membership && await prisma.incident.findFirst({
        where: { id: incidentId, buildingId: membership.apartment.buildingId, locationZone: { not: 'apartment' }, archivedAt: null },
        select: { id: true },
      });
      if (!incident) {
        await this.messenger.sendMessageToUser(maxUserId, 'Комментарии доступны только к активным общим заявкам вашего дома.', mainMenuLinkButtons());
        return true;
      }
      await this.saveSession(user.id, 'incident_comment', { incidentId });
      await this.messenger.sendMessageToUser(maxUserId, 'Напишите комментарий к заявке. Его увидят только жители этого дома и диспетчер.', flowButtons());
      return true;
    }
    if (payload.startsWith('incident:join-public:')) {
      const incidentId = payload.slice('incident:join-public:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      try {
        const result = await joinPublicIncident(user.id, incidentId, membership.apartment.buildingId, membership.apartmentId);
        await this.messenger.sendMessageToUser(maxUserId, result.alreadyJoined ? 'Вы уже присоединились к этой заявке.' : 'Вы присоединились к заявке. Она получила дополнительную поддержку, а вы будете получать обновления.', [[{ text: 'Открыть заявку', payload: `incident:view:${incidentId}` }], [{ text: 'К общим заявкам дома', payload: 'incidents:general' }]]);
      } catch {
        await this.messenger.sendMessageToUser(maxUserId, 'К этой заявке уже нельзя присоединиться.', [[{ text: 'К общим заявкам дома', payload: 'incidents:general' }]]);
      }
      return true;
    }
    if (payload.startsWith('incident:cancel:')) {
      const incidentId = payload.slice('incident:cancel:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      const result = await cancelResidentReport(user.id, incidentId);
      await this.messenger.sendMessageToUser(maxUserId, result
        ? result.reportsLeft === 0 ? 'Обращение отменено. Так как других обращений не осталось, заявка отправлена в архив.' : 'Ваше обращение отменено. Заявка остаётся активной для других жителей.'
        : 'Эту заявку уже нельзя отменить.', mainMenuLinkButtons());
      return true;
    }
    if (payload.startsWith('incident:photo:add:')) {
      const incidentId = payload.slice('incident:photo:add:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      await this.saveSession(user.id, 'add_photo', { incidentId });
      await this.messenger.sendMessageToUser(maxUserId, 'Пришлите фото проблемы. Можно добавить до 3 фото от одного жителя и до 9 на заявку.', flowButtons());
      return true;
    }
    if (payload === 'incident:new-photo') {
      const session = await prisma.botSession.findUnique({ where: { userId: user.id } });
      if (!session) return true;
      const data = sessionDataSchema.parse(session.data);
      await this.saveSession(user.id, 'new_photos', data);
      await this.messenger.sendMessageToUser(maxUserId, 'Пришлите до 3 фото одним или несколькими сообщениями.', flowButtons());
      return true;
    }
    if (payload === 'incident:submit') {
      const session = await prisma.botSession.findUnique({ where: { userId: user.id } });
      if (!session) return true;
      await this.submitDraft(maxUserId, user.id, requireDraft(sessionDataSchema.parse(session.data)));
      return true;
    }

    if (payload === 'flow:cancel') {
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      const membership = await this.getMembership(user.id);
      if (membership) {
        await this.showMainMenu(maxUserId, 'Действие отменено.');
      } else {
        await this.askApartmentCode(maxUserId, user.id);
      }
      return true;
    }

    const session = await prisma.botSession.findUnique({ where: { userId: user.id } });
    if (!session || session.expiresAt < new Date()) {
      await this.messenger.sendMessageToUser(maxUserId, 'Диалог устарел. Выберите действие в главном меню.', mainMenuLinkButtons());
      return true;
    }
    const data = sessionDataSchema.parse(session.data);

    if (payload === 'scope:building' || payload === 'scope:apartment') {
      const scope = payload.slice('scope:'.length) as 'building' | 'apartment';
      await this.askCategory(maxUserId, user.id, { ...data, problemScope: scope }, scope === 'building' ? categoryValues : apartmentCategoryValues);
      return true;
    }

    if (payload.startsWith('category:')) {
      const category = payload.slice('category:'.length) as IncidentCategory;
      if (!allowedCategories(data.problemScope).includes(category)) return false;
      const next = { ...data, category, locationZone: undefined, entranceNumber: undefined, affectedApartmentNumber: undefined };
      if (data.problemScope === 'apartment') {
        await this.askDescription(maxUserId, user.id, { ...next, locationZone: 'apartment', affectedApartmentNumber: data.apartmentNumber });
        return true;
      }
      if (category === 'elevator') {
        await this.askEntrance(maxUserId, user.id, { ...next, locationZone: 'elevator' });
        return true;
      }
      await this.saveSession(user.id, 'zone', next);
      await this.messenger.sendMessageToUser(maxUserId, 'Где возникла проблема?', [
        [{ text: 'Подъезд', payload: 'zone:entrance' }, { text: 'Лифт', payload: 'zone:elevator' }],
        [{ text: 'Двор', payload: 'zone:yard' }, { text: 'Другое', payload: 'zone:common' }],
        ...flowButtons(),
      ]);
      return true;
    }

    if (payload === 'apartment:own') {
      await this.askDescription(maxUserId, user.id, {
        ...data,
        locationZone: 'apartment',
        affectedApartmentNumber: data.apartmentNumber,
      });
      return true;
    }

    if (payload === 'apartment:other') {
      await this.saveSession(user.id, 'affected_apartment', { ...data, locationZone: 'apartment', affectedApartmentNumber: undefined });
      await this.messenger.sendMessageToUser(maxUserId, 'Введите номер проблемной квартиры.', [
        [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
      ]);
      return true;
    }

    if (payload.startsWith('zone:')) {
      const zone = payload.slice('zone:'.length);
      if (!zoneLabels[zone]) return false;
      const next = { ...data, locationZone: zone, entranceNumber: undefined };
      if (zone === 'entrance' || zone === 'elevator') {
        await this.askEntrance(maxUserId, user.id, next);
      } else {
        await this.askDescription(maxUserId, user.id, next);
      }
      return true;
    }

    if (payload.startsWith('entrance:')) {
      const entranceNumber = Number(payload.slice('entrance:'.length));
      if (!Number.isInteger(entranceNumber) || entranceNumber < 1 || entranceNumber > (data.entrancesCount ?? 0)) {
        return false;
      }
      await this.askDescription(maxUserId, user.id, { ...data, entranceNumber });
      return true;
    }

    if (payload === 'incident:new') {
      const incident = await createIncidentFromReport(user.id, requireDraft(data));
      await prisma.botSession.delete({ where: { userId: user.id } });
      await this.messenger.sendMessageToUser(
        maxUserId,
        `Создан отдельный инцидент №${shortId(incident.id)}.`,
        mainMenuLinkButtons(),
      );
      return true;
    }

    if (payload.startsWith('incident:join:')) {
      const incidentId = payload.slice('incident:join:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      const result = await joinIncident(user.id, incidentId, requireDraft(data));
      await prisma.botSession.delete({ where: { userId: user.id } });
      const text = result.alreadyJoined
        ? `Вы уже присоединены к инциденту №${shortId(result.incident.id)}. Повторное обращение не добавлено.`
        : `Вы присоединились к инциденту №${shortId(result.incident.id)} и будете получать обновления.`;
      await this.messenger.sendMessageToUser(maxUserId, text, mainMenuLinkButtons());
      return true;
    }
    return false;
  }

  private async askProblemScope(maxUserId: string, userId: string, data: SessionData) {
    await this.saveSession(userId, 'problem_scope', data);
    await this.messenger.sendMessageToUser(maxUserId, 'Какая проблема произошла?', [
      [{ text: 'Проблема общедомовая', payload: 'scope:building', intent: 'positive' }],
      [{ text: 'Проблема моей квартиры', payload: 'scope:apartment' }],
      [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
    ]);
  }

  private async askCategory(maxUserId: string, userId: string, data: SessionData, categories: IncidentCategory[]) {
    await this.saveSession(userId, 'category', data);
    const rows: CallbackButton[][] = categories.map((category) => [{
      text: categoryLabels[category],
      payload: `category:${category}`,
    }]);
    rows.push([{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }]);
    await this.messenger.sendMessageToUser(maxUserId, 'Сообщение о проблеме попадёт диспетчеру. Если такая заявка уже есть, можно присоединиться к ней — это повысит её приоритет.\n\nВыберите категорию проблемы:', rows);
  }

  private async submitDraft(maxUserId: string, userId: string, draft: ReturnType<typeof requireDraft>) {
    const completeDraft = { ...draft, photos: draft.photos ?? [] };
    const matches = await findMatchingIncidents(userId, completeDraft);
    if (matches.length === 0) {
      const incident = await createIncidentFromReport(userId, completeDraft);
      await prisma.botSession.delete({ where: { userId } });
      await this.messenger.sendMessageToUser(maxUserId, `Готово. Создан новый инцидент №${shortId(incident.id)}. Вы получите уведомления об изменениях.`, mainMenuLinkButtons());
      return;
    }
    await this.saveSession(userId, 'matching', completeDraft);
    const buttons: CallbackButton[][] = matches.map((match) => [{ text: `${match.title.slice(0, 45)} · ${match._count.reports} чел.`, payload: `incident:join:${match.id}`, intent: 'positive' as const }]);
    buttons.push([{ text: 'Это другая проблема', payload: 'incident:new', intent: 'default' }]);
    buttons.push([{ text: 'В главное меню', payload: 'menu:main' }]);
    for (const match of matches) if (match.photos.length) await this.messenger.sendMessageToUser(maxUserId, `Фото к похожему инциденту №${shortId(match.id)}:`, [], toMessengerImages(match.photos));
    await this.messenger.sendMessageToUser(maxUserId, 'Нашлись похожие активные проблемы. Выберите совпадение или создайте новую:', buttons);
  }

  private async askEntrance(maxUserId: string, userId: string, data: SessionData) {
    const count = data.entrancesCount ?? 1;
    await this.saveSession(userId, 'entrance', data);
    const rows: CallbackButton[][] = [];
    for (let entrance = 1; entrance <= count; entrance += 2) {
      rows.push(
        [entrance, entrance + 1]
          .filter((value) => value <= count)
          .map((value) => ({ text: `Подъезд ${value}`, payload: `entrance:${value}` })),
      );
    }
    rows.push([{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }]);
    await this.messenger.sendMessageToUser(maxUserId, 'Выберите подъезд:', rows);
  }

  private async askDescription(maxUserId: string, userId: string, data: SessionData) {
    await this.saveSession(userId, 'description', data);
    const place = data.affectedApartmentNumber
      ? `квартира ${data.affectedApartmentNumber}`
      : data.entranceNumber
      ? `${zoneLabels[data.locationZone ?? '']}, подъезд ${data.entranceNumber}`
      : zoneLabels[data.locationZone ?? ''];
    await this.messenger.sendMessageToUser(maxUserId, `Опишите проблему. Выбрано: ${place}. Фото можно приложить позднее, уже после создания заявки.`, [
      [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
    ]);
  }

  private async askApartmentMessageText(maxUserId: string, userId: string, data: Pick<SessionData, 'recipientApartmentId' | 'recipientApartmentNumber'>, prompt?: string) {
    await this.saveSession(userId, 'resident_message_text', data);
    await this.messenger.sendMessageToUser(maxUserId, prompt ?? `Напишите сообщение квартире ${data.recipientApartmentNumber}.`, flowButtons());
  }

  private async askApartmentChoice(maxUserId: string, userId: string, data: SessionData) {
    await this.saveSession(userId, 'apartment_choice', data);
    await this.messenger.sendMessageToUser(maxUserId, 'Где возникла проблема?', [
      [{ text: `Моя квартира (${data.apartmentNumber})`, payload: 'apartment:own', intent: 'positive' }],
      [{ text: 'Другая квартира', payload: 'apartment:other' }],
      [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
    ]);
  }

  private async askApartmentCode(maxUserId: string, userId: string) {
    const buildings = await prisma.building.findMany({ orderBy: { address: 'asc' }, select: { id: true, address: true }, take: 20 });
    await this.saveSession(userId, 'building_choice', {});
    if (buildings.length === 0) {
      await this.messenger.sendMessageToUser(maxUserId, 'Дома пока не добавлены диспетчером.');
      return;
    }
    await this.messenger.sendMessageToUser(
      maxUserId,
      'Выберите свой дом:',
      [...buildings.map((building) => [{ text: building.address, payload: `building:choose:${building.id}` }]), ...flowButtons()],
    );
  }

  private async showMainMenu(maxUserId: string, prefix?: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { maxUserId } });
    const membership = await this.getMembership(user.id);
    const chat = membership?.apartment.building.chatLink
      ? `Чат дома: ${membership.apartment.building.chatLink}`
      : 'Чат дома: ещё не создан.';
    await this.messenger.sendMessageToUser(
      maxUserId,
      [prefix, 'Добро пожаловать! Здесь можно сообщить о проблеме, посмотреть свои заявки, открыть общие заявки вашего дома и присоединиться к важной, вести обсуждение с соседями, заполнить данные квартиры и найти владельца автомобиля.', 'Рекомендуем сначала изучить раздел «Возможности бота».','В разделе поиска автомобиля контакты показываются только с согласия владельца.', chat, 'Что вы хотите сделать?'].filter(Boolean).join('\n\n'),
      mainMenuButtons(),
    );
  }

  private async showProfile(maxUserId: string, userId: string) {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return; }
    const [profile, vehicles] = await Promise.all([
      prisma.residentProfile.findUnique({ where: { apartmentId: membership.apartmentId }, include: { people: { where: { isVehicleOwner: false }, orderBy: { fullName: 'asc' } } } }),
      prisma.vehicle.findMany({ where: { apartmentId: membership.apartmentId }, select: { licensePlate: true, owner: { select: { fullName: true, phones: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    await prisma.botSession.deleteMany({ where: { userId } });
    const lines = [
      `МОЯ КВАРТИРА · ${membership.apartment.number}`,
      `Жильцов: ${profile?.residentsCount ?? 'не указано'}`,
      `Телефоны: ${profile?.phones.length ? profile.phones.join(', ') : 'не указаны'}`,
      `Показ телефонов: ${profile?.phoneVisibility === 'vehicle_lookup' ? 'включён для «Узнать чье авто»' : 'выключен'}`,
      `\nЖИТЕЛИ\n${profile?.people.length ? profile.people.map((person) => `• ${person.fullName}${person.phones.length ? ` · ${person.phones.join(', ')}` : ''}`).join('\n') : '• не указаны'}`,
      `\nАВТОМОБИЛИ\n${vehicles.length ? vehicles.map((vehicle) => `• ${vehicle.licensePlate}${vehicle.owner ? ` · ${vehicle.owner.fullName}${vehicle.owner.phones.length ? ` · ${vehicle.owner.phones.join(', ')}` : ''}` : ''}`).join('\n') : '• не указаны'}`,
    ];
    await this.messenger.sendMessageToUser(maxUserId, lines.join('\n'), [
      [{ text: 'Количество жильцов', payload: 'profile:residents' }],
      [{ text: 'Телефон', payload: 'profile:phone' }],
      [{ text: 'Включить видимость телефонов', payload: 'profile:visibility' }],
      [{ text: 'ФИО жильцов', payload: 'profile:people' }],
      [{ text: 'Обновить информацию об авто', payload: 'profile:cars' }],
      [{ text: 'Сменить квартиру', payload: 'apartment:change' }],
      [{ text: 'Удалиться из квартиры', payload: 'apartment:leave', intent: 'negative' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  private async showMyIncidents(maxUserId: string, userId: string, archive: boolean) {
    const reports = await prisma.report.findMany({
      where: {
        authorUserId: userId,
        incident: archive
          ? { OR: [{ archivedAt: { not: null } }, { status: { in: ['resolved', 'rejected'] } }] }
          : { archivedAt: null, status: { notIn: ['resolved', 'rejected'] } },
      },
      orderBy: { incident: { updatedAt: 'desc' } },
      take: 10,
      include: {
        incident: {
          include: { building: { select: { address: true } } },
        },
      },
    });
    if (reports.length === 0) {
      await this.messenger.sendMessageToUser(maxUserId, archive ? 'В архиве пока нет завершённых заявок.' : 'У вас пока нет активных заявок.', [
        [{ text: archive ? 'К активным заявкам' : 'Архив завершённых', payload: archive ? 'incidents:list' : 'incidents:archive' }],
        [{ text: 'В главное меню', payload: 'menu:main' }],
      ]);
      return;
    }
    const buttons: CallbackButton[][] = reports.map(({ incident }) => [{
      text: `№${shortId(incident.id)} · ${statusLabels[incident.status]}`,
      payload: `incident:view:${incident.id}`,
    }]);
    buttons.push([{ text: archive ? 'К активным заявкам' : 'Архив завершённых', payload: archive ? 'incidents:list' : 'incidents:archive' }]);
    buttons.push([{ text: 'В главное меню', payload: 'menu:main', intent: 'default' }]);
    await this.messenger.sendMessageToUser(
      maxUserId,
      `${archive ? 'Завершённые и архивные' : 'Активные'} заявки (${reports.length}). Здесь отображаются заявки, которые вы создали или к которым присоединились. Выберите заявку, чтобы посмотреть подробности:`,
      buttons,
    );
  }

  private async showGeneralIncidents(maxUserId: string, userId: string) {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return; }
    const incidents = await prisma.incident.findMany({
      where: { buildingId: membership.apartment.buildingId, archivedAt: null, locationZone: { not: 'apartment' } },
      orderBy: [{ reports: { _count: 'desc' } }, { updatedAt: 'desc' }],
      take: 10,
      include: { _count: { select: { reports: true, comments: true } } },
    });
    if (!incidents.length) {
      await this.messenger.sendMessageToUser(maxUserId, 'В вашем доме пока нет активных общих заявок. Создайте первую через «Сообщить о проблеме».', mainMenuLinkButtons());
      return;
    }
    const buttons: CallbackButton[][] = incidents.map((incident, index) => [{
      text: `${index === 0 && incident._count.reports > 1 ? '🔥 ' : ''}${incident.title.slice(0, 36)} · ${incident._count.reports} жителей · ${incident._count.comments} комм.`,
      payload: `incident:view:${incident.id}`,
    }]);
    buttons.push([{ text: 'В главное меню', payload: 'menu:main' }]);
    await this.messenger.sendMessageToUser(maxUserId, `Общие заявки дома — это проблемы, которые видят все жители. Список отсортирован по поддержке: чем больше жителей присоединилось, тем выше заявка.`, buttons);
  }

  private async showBotInfo(maxUserId: string) {
    await this.messenger.sendMessageToUser(maxUserId, [
      'Возможности бота',
      '• Сообщить о проблеме — создайте заявку для диспетчера, выбрав категорию и место. Если похожая заявка уже есть, можно присоединиться к ней.',
      '• Мои заявки — ваши созданные заявки и те, к которым вы присоединились. В них доступны статус, срок и уведомления.',
      '• Общие заявки дома — открытый для жителей дома список. Заявки с большей поддержкой жителей поднимаются выше; в карточке можно читать и оставлять комментарии.',
      '• Моя квартира — заполните число жителей, телефоны, ФИО и автомобили, а также при необходимости смените квартиру или удалите привязку. Телефоны выдаются при поиске автомобиля только с вашего согласия.',
      '• Узнать чье авто — поиск владельца среди всех подключённых домов по госномеру без региона.',
      '• Сообщение квартире — напишите жителям другой квартиры в вашем доме; получатель сможет сразу ответить.',
      '• Номера экстренных служб — актуальные контакты аварийных и обслуживающих служб от диспетчера.',
      '• Удалиться из квартиры — удаляет вашу привязку к текущей квартире. Вы останетесь в боте, но доступ к её заявкам и профилю будет закрыт до новой привязки. Доступно не более двух раз в день.',
    ].join('\n\n'), [[{ text: 'В главное меню', payload: 'menu:main' }]]);
  }

  private async showEmergencyServices(maxUserId: string) {
    const services = await prisma.emergencyService.findMany({ orderBy: { createdAt: 'asc' } });
    const text = services.length
      ? `Номера экстренных служб\n\n${services.map((service) => `${service.name}\n${service.phone}\n${service.description}`).join('\n\n')}`
      : 'Номера экстренных служб\n\nДиспетчер пока не добавил контакты. Если ситуация угрожает жизни или здоровью, звоните 112.';
    await this.messenger.sendMessageToUser(maxUserId, text, [[{ text: 'В главное меню', payload: 'menu:main' }]]);
  }

  private async showIncident(maxUserId: string, userId: string, incidentId: string) {
    const membership = await this.getMembership(userId);
    const incident = await prisma.incident.findFirst({
      where: {
        id: incidentId,
        OR: [
          { reports: { some: { authorUserId: userId } } },
          ...(membership ? [{ buildingId: membership.apartment.buildingId, locationZone: { not: 'apartment' } }] : []),
        ],
      },
      include: {
        building: { select: { address: true } },
        _count: { select: { reports: true, comments: true } },
        reports: { where: { authorUserId: userId }, select: { id: true } },
        comments: { orderBy: { createdAt: 'asc' }, take: 10, select: { text: true, createdAt: true, apartment: { select: { number: true } } } },
        photos: { orderBy: { createdAt: 'asc' }, select: { token: true, url: true } },
      },
    });
    if (!incident) {
      await this.messenger.sendMessageToUser(maxUserId, 'Заявка не найдена.', mainMenuLinkButtons());
      return;
    }
    const isCurrentPublicIncident = Boolean(
      membership
      && incident.locationZone !== 'apartment'
      && incident.buildingId === membership.apartment.buildingId,
    );
    const hasOwnReport = incident.reports.length > 0;
    const place = incident.entranceNumber
      ? `${zoneLabels[incident.locationZone] ?? incident.locationZone}, подъезд ${incident.entranceNumber}`
      : zoneLabels[incident.locationZone] ?? incident.locationZone;
    const parts = [
      `Инцидент №${shortId(incident.id)}`,
      `Статус: ${statusLabels[incident.status]}.`,
      `Категория: ${categoryLabels[incident.category]}.`,
      `Место: ${place}.`,
      `Адрес: ${incident.building.address}.`,
      `Обращений жителей: ${incident._count.reports}.`,
      `Комментарии жителей: ${incident._count.comments}.`,
    ];
    if (incident.dueAt && !['resolved', 'rejected'].includes(incident.status)) parts.push(`Плановый срок: ${formatDate(incident.dueAt)}.`);
    if (incident.delayReason) parts.push(`Причина переноса: ${incident.delayReason}.`);
    if (incident.rejectionReason) parts.push(`Причина отклонения: ${incident.rejectionReason}.`);
    if (incident.comments.length) parts.push(`Обсуждение:\n${incident.comments.map((comment) => `• Квартира ${comment.apartment?.number ?? 'не указана'}: ${comment.text}`).join('\n')}`);
    const isActive = !['resolved', 'rejected'].includes(incident.status);
    const incidentActions: CallbackButton[] = [
      ...(isCurrentPublicIncident && isActive ? [{ text: 'Комментарий', payload: `incident:comment:${incident.id}` }] : []),
      ...(isActive && hasOwnReport ? [{ text: 'Добавить фото', payload: `incident:photo:add:${incident.id}` }] : []),
    ];
    const buttons: CallbackButton[][] = [
      [{ text: 'Мои заявки', payload: 'incidents:list' }, { text: 'Заявки дома', payload: 'incidents:general' }],
      ...(incidentActions.length ? [incidentActions] : []),
      ...(isCurrentPublicIncident && isActive && !hasOwnReport ? [[{ text: 'Присоединиться к заявке', payload: `incident:join-public:${incident.id}`, intent: 'positive' as const }]] : []),
      ...(isActive && hasOwnReport ? [[{ text: 'Отменить моё обращение', payload: `incident:cancel:${incident.id}`, intent: 'negative' as const }]] : []),
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ];
    await this.messenger.sendMessageToUser(maxUserId, parts.join('\n'), buttons, toMessengerImages(incident.photos));
  }

  private getMembership(userId: string) {
    return prisma.residentMembership.findFirst({
      where: { userId, revokedAt: null },
      include: {
        apartment: {
          include: { building: { select: { entrancesCount: true, chatLink: true } } },
        },
      },
      orderBy: { verifiedAt: 'desc' },
    });
  }

  private async confirmApartmentMembership(maxUserId: string, userId: string, apartmentId: string, apartmentNumber?: string) {
    await prisma.$transaction(async (tx) => {
      await tx.residentMembership.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.residentMembership.upsert({
        where: { userId_apartmentId: { userId, apartmentId } },
        update: { revokedAt: null, verifiedAt: new Date() },
        create: { userId, apartmentId },
      });
      await tx.botSession.deleteMany({ where: { userId } });
    });
    await this.showMainMenu(maxUserId, `Квартира ${apartmentNumber ?? ''} подтверждена.`.trim());
  }

  private async saveSession(userId: string, step: string, data: SessionData) {
    await prisma.botSession.upsert({
      where: { userId },
      update: { step, data, expiresAt: expiresIn30Minutes() },
      create: { userId, step, data, expiresAt: expiresIn30Minutes() },
    });
  }

  private ensureUser(maxUserId: string) {
    return prisma.user.upsert({
      where: { maxUserId },
      update: {},
      create: { maxUserId },
    });
  }
}

function requireDraft(data: SessionData) {
  const draft = z.object({
    apartmentId: z.string().uuid(),
    buildingId: z.string().uuid(),
    category: z.enum(categoryValues as [IncidentCategory, ...IncidentCategory[]]),
    locationZone: z.string().min(1),
    entranceNumber: z.number().int().min(1).max(20).optional(),
    affectedApartmentNumber: z.string().trim().min(1).max(20).optional(),
    description: z.string().min(5).max(500),
    photos: z.array(z.object({ token: z.string(), url: z.string().optional() })).max(3).optional(),
  }).parse(data);
  if ((draft.locationZone === 'entrance' || draft.locationZone === 'elevator') && !draft.entranceNumber) {
    throw new Error('Entrance number is required for this location');
  }
  return draft;
}

function mainMenuButtons(): CallbackButton[][] {
  return [
    [{ text: 'Сообщить о проблеме', payload: 'incident:create', intent: 'positive' }],
    [{ text: 'Мои заявки', payload: 'incidents:list' }, { text: 'Заявки дома', payload: 'incidents:general' }],
    [{ text: 'Моя квартира', payload: 'profile:view' }, { text: 'Узнать чье авто', payload: 'car:search' }],
    [{ text: 'Сообщение квартире', payload: 'resident:message' }],
    [{ text: 'Номера экстренных служб', payload: 'emergency:services' }],
    [{ text: 'Возможности бота', payload: 'bot:info' }],
  ];
}

function mainMenuLinkButtons(): CallbackButton[][] {
  return [[{ text: 'В главное меню', payload: 'menu:main' }]];
}

function flowButtons(): CallbackButton[][] {
  return [[{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }]];
}

function normalizePlate(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
  return normalized;
}

function plateBase(value: string) {
  const match = value.match(/^([A-ZА-Я]\d{3}[A-ZА-Я]{2})(\d{2,3})$/);
  return match ? match[1] : value;
}

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits.length === 10 ? `7${digits}` : digits.length === 11 && digits.startsWith('7') ? digits : '';
  return normalized ? `+${normalized}` : null;
}

function extractPhones(value: string): string[] {
  const candidates = value.match(/(?:\+?\s*[78])(?:[\s().-]*\d){10}/g) ?? [];
  return [...new Set(candidates.map(normalizePhone).filter((phone): phone is string => Boolean(phone)))];
}

function removePhones(value: string): string {
  return value.replace(/(?:\+?\s*[78])(?:[\s().-]*\d){10}/g, ' ');
}

async function verifyUkCode(value: string) {
  if (!/^\d{10}$/.test(value)) return false;
  const savedCode = await prisma.ukAccessCode.findUnique({ where: { id: 'main' }, select: { code: true } });
  const code = savedCode?.code ?? env.RESIDENT_UK_CODE;
  return value.length === code.length && timingSafeEqual(Buffer.from(value), Buffer.from(code));
}

function toMessengerImages(photos: Array<{ token: string; url: string | null }>): ImageAttachment[] {
  return photos.map((photo) => ({ token: photo.token, ...(photo.url ? { url: photo.url } : {}) }));
}

function formatDate(value: Date) {
  return value.toLocaleString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function allowedCategories(scope: SessionData['problemScope']): IncidentCategory[] {
  return scope === 'apartment' ? apartmentCategoryValues : categoryValues;
}

function startOfYekaterinburgDay(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')) - 5 * 60 * 60 * 1000);
}

function expiresIn30Minutes() {
  return new Date(Date.now() + 30 * 60 * 1000);
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}
