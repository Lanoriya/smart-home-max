import { z } from 'zod';
import { apartmentNumberWhere, normalizeApartmentNumber } from '../shared/apartment-number.js';
import { quickDialOf } from '../companies/quick-dial.js';
import { legalTermLine, legalTermOf } from '../incidents/legal-terms.js';
import { dutiesFor } from '../companies/duties.js';
import type { IncidentCategory, Prisma } from '@prisma/client';
import type { CallbackButton, ImageAttachment, Messenger } from './messenger.js';
import { prisma } from '../shared/prisma.js';
import { env } from '../config/env.js';
import { inviteCodeMatches } from '../users/invite-code.js';
import { buildingCodeMatches } from '../buildings/access-code.js';
import { normalizeRussianPhone } from '../shared/phone.js';
import { createWebLoginLink } from '../auth/web-link.js';
import { publicPhotoUrl } from '../routes/photos.js';
import { logger } from '../shared/logger.js';
import type { SharedContact } from './max-update.js';
import { addressMatches, compareBuildings } from '../buildings/address.js';
import { blocks, bold, html } from '../shared/html.js';
import { bindResident, leaveApartment, cancelJoinRequest, createJoinRequest, decideJoinRequest, otherResidentsCount, pendingJoinRequest } from '../residents/join-requests.js';
import {
  categoryLabels,
  categoryValues,
  createIncidentFromReport,
  findMatchingIncidents,
  joinIncident,
  joinPublicIncident,
  cancelResidentReport,
  addIncidentPhotos,
  zonesByCategory,
} from '../incidents/incident-service.js';
import { normalizePlate, plateWhere } from '../shared/plates.js';
import { displayPhone } from '../shared/phone.js';
import { castVote, pollButtons, pollFor, pollsFor } from '../polls/polls.js';
import { buildingZone, formatInZone, localTime } from '../shared/time-zone.js';
import { lookupPhones, lookupVehicleInclude } from '../residents/vehicle-phones.js';
import { codeAttemptsLeft, registerCodeFailure } from '../residents/code-attempts.js';
import { canClearApartmentData, clearApartmentData } from '../residents/apartment-data.js';
import { feedbackOpen, feedbackState, giveFeedback, type FeedbackResult } from '../incidents/resident-feedback.js';
import { feedbackButtons } from '../incidents/admin-incidents.js';
import { contractKey } from '../shared/contract.js';

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
  personId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  problemScope: z.enum(['building', 'apartment']).optional(),
  phoneVisibility: z.enum(['hidden', 'vehicle_lookup']).optional(),
  // The city chosen while looking for a house: streets and search stay in it.
  city: z.string().max(100).optional(),
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
const residentMessagesPerHour = 10;
const buildingButtonsLimit = 20;
const buildingSearchLimit = 300;
const housesPerPage = 20;
const buildingChoiceSelect = { id: true, address: true, street: true, house: true, city: true } as const;
const announcementsPageSize = 5;
const incidentCommentsShown = 5;
const incidentsPerPage = 10;
const peopleLimit = 10;
const carsLimit = 5;
const phonesLimit = 5;

export class IncidentFlow {
  constructor(private readonly messenger: Messenger) {}

  async start(maxUserId: string): Promise<void> {
    const user = await this.ensureUser(maxUserId);
    const membership = await this.getMembership(user.id);
    if (!membership) {
      await this.showHome(maxUserId, user.id);
      return;
    }
    await prisma.botSession.deleteMany({ where: { userId: user.id } });
    await this.showMainMenu(maxUserId);
  }

  // A QR code at the entrance: the bot opens with this house chosen, the
  // resident types only the apartment and proves it as usual.
  async startAtHouse(maxUserId: string, buildingId: string): Promise<void> {
    const user = await this.ensureUser(maxUserId);
    const building = await prisma.building.findUnique({ where: { id: buildingId }, select: { id: true, address: true } });
    if (!building) { await this.start(maxUserId); return; }
    const membership = await this.getMembership(user.id);
    if (membership) {
      if (membership.apartment.buildingId === building.id) { await this.start(maxUserId); return; }
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold(building.address)],
        [`Вы уже подключены к адресу ${membership.apartment.building.address}, кв. ${membership.apartment.number}.`],
        ['Если вы переехали, смените квартиру — заявки и объявления придут по новому адресу.'],
      ), [[{ text: 'Сменить квартиру', payload: 'apartment:change' }], ...mainMenuLinkButtons()]);
      return;
    }
    if (await pendingJoinRequest(user.id)) { await this.showJoinWaiting(maxUserId, user.id); return; }
    await prisma.botSession.deleteMany({ where: { userId: user.id } });
    if (!(await prisma.user.findUnique({ where: { id: user.id }, select: { consentAt: true } }))?.consentAt) {
      await this.askConsent(maxUserId, building.id);
      return;
    }
    await this.saveSession(user.id, 'apartment_number', { buildingId: building.id });
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Добро пожаловать в «Домовед»')],
      ['Здесь можно сообщить о проблеме в управляющую компанию и следить за заявкой, читать объявления УК и голосовать в опросах дома.'],
      [html`Дом: ${bold(building.address)}`, 'Введите номер своей квартиры цифрами.'],
    ), await this.addressButtons(user.id, 'inside'));
  }

  async begin(maxUserId: string): Promise<void> {
    const user = await this.ensureUser(maxUserId);
    const membership = await this.getMembership(user.id);

    if (!membership) {
      await this.showHome(maxUserId, user.id);
      return;
    }

    await this.askProblemScope(maxUserId, user.id, {
      apartmentId: membership.apartmentId,
      buildingId: membership.apartment.buildingId,
      apartmentNumber: membership.apartment.number,
      entrancesCount: membership.apartment.building.entrancesCount,
    });
  }

  // A contact sent with the "share contact" button. Only the resident's own
  // contact is accepted: a forwarded card of somebody else is refused.
  async handleContact(maxUserId: string, contact: SharedContact): Promise<void> {
    const user = await this.ensureUser(maxUserId);
    if (contact.ownerId && contact.ownerId !== maxUserId) {
      await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Это чужой контакт')], ['Поделиться можно только своим номером: нажмите «Поделиться номером» в разделе «Моя квартира».']), [[{ text: 'Моя квартира', payload: 'profile:view' }], ...mainMenuLinkButtons()]);
      return;
    }
    const digits = contact.phone?.replace(/[^\d+]/g, '') ?? '';
    const phone = contact.phone ? (normalizeRussianPhone(contact.phone) ?? (digits.replace(/\D/g, '').length >= 7 ? `+${digits.replace(/\D/g, '')}` : null)) : null;
    if (!phone) {
      logger.warn({ attachment: contact.attachmentShape }, 'MAX contact without a readable phone');
      await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Не удалось прочитать номер')], ['MAX прислал контакт без номера телефона. Номер можно указать вручную в разделе «Моя квартира» → «Телефоны».']), [[{ text: 'Моя квартира', payload: 'profile:view' }], ...mainMenuLinkButtons()]);
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { sharedPhone: phone, phoneSharedAt: new Date() } });
    await prisma.botSession.deleteMany({ where: { userId: user.id } });
    if (await this.getMembership(user.id)) await this.showProfile(maxUserId, user.id, `Номер ${displayPhone(phone)} сохранён. Его видят жители вашей квартиры и УК.`);
    else await this.showHome(maxUserId, user.id);
  }

  async handleText(maxUserId: string, text: string, images: ImageAttachment[] = []): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { maxUserId } });
    if (!user) return false;
    const session = await prisma.botSession.findUnique({ where: { userId: user.id } });
    if (!session || session.expiresAt < new Date()) return false;
    const parsedSession = sessionDataSchema.safeParse(session.data);
    if (!parsedSession.success) return false;
    const data = parsedSession.data;

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
    if (session.step === 'reopen_reason') {
      if (!data.incidentId) return false;
      const reason = text.trim();
      if (reason.length < 2 || reason.length > 500) {
        await this.messenger.sendMessageToUser(maxUserId, reason.length > 500 ? `Слишком длинно: ${reason.length} символов, можно до 500.` : 'Напишите текстом, что осталось не так, или нажмите «Вернуть без описания».', [
          [{ text: 'Вернуть без описания', payload: `incident:reopen-now:${data.incidentId}`, intent: 'negative' }],
          [{ text: 'Отмена', payload: `incident:view:${data.incidentId}` }],
        ]);
        return true;
      }
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.answerFeedback(maxUserId, data.incidentId, await giveFeedback(user.id, data.incidentId, { resolved: false, comment: reason }));
      return true;
    }
    if (session.step === 'incident_comment') {
      const comment = text.trim();
      const back: CallbackButton[][] = data.incidentId ? [[{ text: 'Назад к заявке', payload: `incident:view:${data.incidentId}` }]] : mainMenuLinkButtons();
      if (!comment && images.length) {
        await this.messenger.sendMessageToUser(maxUserId, blocks(
          [bold('В комментарий нужен текст')],
          ['Фото к обсуждению не прикрепляются. Если это ваша заявка, добавьте фото кнопкой «Добавить фото» в карточке заявки.'],
          ['Напишите комментарий текстом или вернитесь к заявке.'],
        ), back);
        return true;
      }
      if (!data.incidentId || comment.length < 2 || comment.length > 1000) {
        await this.messenger.sendMessageToUser(maxUserId, comment.length > 1000 ? `Комментарий слишком длинный: ${comment.length} символов, можно до 1000. Сократите его.` : 'Напишите комментарий хотя бы из двух символов.', back);
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
      // Back to the card: the new comment is visible there in the discussion.
      await this.showIncident(maxUserId, user.id, incident.id);
      return true;
    }
    if (session.step === 'resident_message_apartment') {
      const apartmentNumber = normalizeApartmentNumber(text);
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      if (!apartmentNumber) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите номер квартиры, например: 45.');
        return true;
      }
      const apartment = await prisma.apartment.findFirst({ where: { buildingId: membership.apartment.buildingId, ...apartmentNumberWhere(apartmentNumber) }, select: { id: true, number: true, _count: { select: { memberships: { where: { revokedAt: null } } } } } });
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
      // One message creates a row per recipient in a single INSERT, and all those
      // rows share the same created_at, so distinct timestamps count messages.
      const sentRecently = await prisma.outboxMessage.findMany({
        where: { type: 'resident_message', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, payload: { path: ['senderUserId'], equals: user.id } },
        distinct: ['createdAt'],
        select: { id: true },
        take: residentMessagesPerHour,
      });
      if (sentRecently.length >= residentMessagesPerHour) {
        await prisma.botSession.deleteMany({ where: { userId: user.id } });
        await this.messenger.sendMessageToUser(maxUserId, `Можно отправить не более ${residentMessagesPerHour} сообщений соседям в час. Попробуйте позже.`, mainMenuLinkButtons());
        return true;
      }
      const recipients = await prisma.residentMembership.findMany({ where: { apartmentId: data.recipientApartmentId, revokedAt: null }, distinct: ['userId'], select: { user: { select: { maxUserId: true } } } });
      if (!recipients.length) {
        await prisma.botSession.deleteMany({ where: { userId: user.id } });
        await this.messenger.sendMessageToUser(maxUserId, 'У этой квартиры больше нет доступных получателей.', mainMenuLinkButtons());
        return true;
      }
      const buttons: CallbackButton[][] = [[{ text: 'Ответить квартире', payload: `resident:reply:${membership.apartmentId}`, intent: 'positive' }], [{ text: 'Отмена', payload: 'menu:main', intent: 'negative' }]];
      await prisma.outboxMessage.createMany({ data: recipients.map(({ user: recipient }) => ({ type: 'resident_message', payload: { userId: recipient.maxUserId, senderUserId: user.id, text: blocks([bold(`Сообщение от квартиры ${membership.apartment.number}`)], [message]).value, format: 'html', buttons } })) });
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

    if (session.step.startsWith('household_')) return this.handleHouseholdText(maxUserId, user.id, session.step, data, text);

    if (session.step === 'profile_residents') {
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      const residentsCount = Number(text.trim());
      const listed = await this.countKnownResidents(membership.apartmentId);
      if (!Number.isInteger(residentsCount) || residentsCount < 1 || residentsCount > 20) {
        await this.messenger.sendMessageToUser(maxUserId, 'Напишите число от 1 до 20.', [[{ text: 'Отмена', payload: 'profile:view' }]]);
        return true;
      }
      if (residentsCount < listed) {
        await this.messenger.sendMessageToUser(maxUserId, `В боте и в списке «Другие жильцы» уже ${listed}. Укажите не меньше ${listed}.`, [[{ text: 'Отмена', payload: 'hh:people' }]]);
        return true;
      }
      await prisma.residentProfile.upsert({ where: { apartmentId: membership.apartmentId }, update: { residentsCount }, create: { apartmentId: membership.apartmentId, residentsCount } });
      await this.showPeople(maxUserId, user.id, membership.apartmentId, 'Число проживающих сохранено.');
      return true;
    }
    if (session.step === 'car_search') {
      const membership = await this.getMembership(user.id);
      if (!membership) return this.askApartmentCode(maxUserId, user.id).then(() => true);
      const vehicles = await prisma.vehicle.findMany({
        where: plateWhere(text),
        include: { ...lookupVehicleInclude, apartment: { include: { profile: true, building: { select: { address: true } }, memberships: { where: { revokedAt: null }, select: { userId: true } } } } },
        orderBy: { licensePlate: 'asc' },
        take: 10,
      });
      const matches = vehicles.flatMap((vehicle) => {
        if (!vehicle.apartment) return [];
        const phones = lookupPhones(vehicle);
        return phones.length ? [{ vehicle, phones }] : [];
      });
      if (!matches.length) {
        await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Владелец не найден')], ['Такой машины нет среди подключённых домов, или владелец не разрешил показывать телефон.']), [[{ text: 'Искать другой номер', payload: 'car:search' }], ...mainMenuLinkButtons()]);
      } else {
        await this.messenger.sendMessageToUser(maxUserId, blocks(
          [bold(matches.length > 1 ? `Найдено автомобилей: ${matches.length}` : 'Автомобиль найден')],
          ...matches.map(({ vehicle, phones }) => [
            bold(vehicle.licensePlate),
            `Владелец: ${vehicle.owner?.fullName ?? 'не указан'}`,
            `Телефон: ${phones.join(', ')}`,
            `Адрес: ${vehicle.apartment!.building.address}, кв. ${vehicle.apartment!.number}`,
          ]),
        ), [[{ text: 'Искать другой номер', payload: 'car:search' }], ...mainMenuLinkButtons()]);
      }
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      return true;
    }

    if (session.step === 'building_search') {
      const query = text.trim();
      if (query.length < 2 || query.length > 100) {
        await this.messenger.sendMessageToUser(maxUserId, 'Напишите хотя бы 2 символа, например «садовая» или «мира 12».', await this.addressButtons(user.id, 'list'));
        return true;
      }
      // Matching is done in memory so that "садовая 7", "Садовая ул. 7 к1" and
      // "мира12" all find the building whatever the address spelling is.
      const buildings = (await prisma.building.findMany({ where: data.city ? { city: data.city } : {}, select: buildingChoiceSelect }))
        .filter((building) => addressMatches(building.address, query))
        .sort(compareBuildings)
        .slice(0, buildingSearchLimit);
      if (!buildings.length) {
        await this.messenger.sendMessageToUser(maxUserId, blocks(
          [bold('Ничего не нашлось')],
          ['Проверьте название улицы. Можно писать коротко и без «ул.», например «садовая 7» или «мира 12».'],
        ), [...await this.addressButtons(user.id, 'list'), [{ text: 'Показать все улицы', payload: 'address:browse' }]]);
        return true;
      }
      if (buildings.length <= buildingButtonsLimit) {
        await this.showBuildingChoice(maxUserId, user.id, buildings, 'Выберите свой дом:', data.city);
        return true;
      }
      const streets = uniqueStreets(buildings);
      if (streets.length <= buildingButtonsLimit) {
        await this.showStreetChoice(maxUserId, user.id, streets, 'Выберите улицу:', data.city);
        return true;
      }
      await this.messenger.sendMessageToUser(maxUserId, 'Под запрос подходит слишком много улиц. Введите название точнее.', await this.addressButtons(user.id, 'list'));
      return true;
    }

    if (session.step === 'apartment_number') {
      const apartmentNumber = normalizeApartmentNumber(text);
      if (!apartmentNumber || !data.buildingId) {
        await this.messenger.sendMessageToUser(maxUserId, 'Введите номер квартиры, например: 45 или 12А.');
        return true;
      }
      const apartment = await prisma.apartment.findFirst({
        where: { buildingId: data.buildingId, ...apartmentNumberWhere(apartmentNumber) },
        include: { building: { select: { entrancesCount: true, apartmentsCount: true, address: true } } },
      });
      if (!apartment || (/^\d+$/.test(apartmentNumber) && Number(apartmentNumber) > apartment.building.apartmentsCount)) {
        await this.messenger.sendMessageToUser(maxUserId, 'Такой квартиры нет в выбранном доме. Проверьте номер.', await this.addressButtons(user.id, 'inside'));
        return true;
      }
      await this.saveSession(user.id, 'building_code', {
        apartmentId: apartment.id,
        buildingId: apartment.buildingId,
        apartmentNumber: apartment.number,
        entrancesCount: apartment.building.entrancesCount,
      });
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold('Код дома или номер договора'), `${apartment.building.address}, кв. ${apartment.number}`],
        ['Введите один из двух кодов:'],
        ['— номер договора управления этой квартиры: обычно 10 цифр, бывает с буквами и «/»; он есть в квитанции и в самом договоре. С ним подключение сразу;', '— или код дома: ровно 10 цифр, его выдаёт управляющая компания (доска объявлений, квитанция, чат дома).'],
      ), await this.addressButtons(user.id, 'inside'));
      return true;
    }

    if (session.step === 'building_code' || session.step === 'apartment_code') {
      // Counted in the database for the person, as in the app: /start or a new
      // dialog does not give new attempts.
      if (await codeAttemptsLeft(user.id) === 0) {
        await prisma.botSession.deleteMany({ where: { userId: user.id } });
        await this.messenger.sendMessageToUser(maxUserId, 'Слишком много неверных кодов за последний час. Попробуйте позже и уточните код в управляющей компании.', mainMenuLinkButtons());
        return true;
      }
    }

    if (session.step === 'building_code') {
      const building = data.buildingId ? await prisma.building.findUnique({ where: { id: data.buildingId }, select: { accessCode: true } }) : null;
      // The contract of this apartment is enough to connect, as in the app.
      const contract = data.apartmentId ? await prisma.apartment.findUnique({ where: { id: data.apartmentId }, select: { contractNumber: true } }) : null;
      const typed = contractKey(text);
      // Checked first: the same number as the house code still counts as the contract.
      if (data.apartmentId && contract?.contractNumber && typed.length >= 4 && typed === contractKey(contract.contractNumber)) {
        await this.confirmApartmentMembership(maxUserId, user.id, data.apartmentId, data.apartmentNumber);
        return true;
      }
      if (!data.apartmentId || !building || !buildingCodeMatches(text, building.accessCode)) {
        const left = await registerCodeFailure(user.id);
        if (left === 0) {
          await prisma.botSession.deleteMany({ where: { userId: user.id } });
          await this.messenger.sendMessageToUser(maxUserId, 'Слишком много неверных кодов за последний час. Попробуйте позже и уточните код дома в управляющей компании.', mainMenuLinkButtons());
          return true;
        }
        await this.messenger.sendMessageToUser(maxUserId, blocks(
          [bold('Код не подошёл'), await this.chosenAddress(data)],
          [`Это не код этого дома и не номер договора квартиры. Проверьте и попробуйте ещё раз. Осталось попыток: ${left}.`],
        ), await this.addressButtons(user.id, 'inside'));
        return true;
      }
      const apartment = await prisma.apartment.findUnique({ where: { id: data.apartmentId }, select: { inviteCodeHash: true } });
      if (apartment?.inviteCodeHash) {
        await this.saveSession(user.id, 'apartment_code', data);
        await this.messenger.sendMessageToUser(maxUserId, blocks(
          [bold('Код квартиры'), await this.chosenAddress(data)],
          ['Код дома подошёл. У этой квартиры есть ещё и свой код — введите его: не короче 6 символов, обычно 6 цифр. Его выдаёт управляющая компания.'],
        ), await this.addressButtons(user.id, 'inside'));
        return true;
      }
      // The building code is known to every resident of the building, so it is
      // not enough to join an apartment where somebody already lives.
      if (await otherResidentsCount(data.apartmentId, user.id) > 0) {
        await this.requestToJoin(maxUserId, user.id, data.apartmentId);
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
        const left = await registerCodeFailure(user.id);
        if (left === 0) {
          await prisma.botSession.deleteMany({ where: { userId: user.id } });
          await this.messenger.sendMessageToUser(maxUserId, 'Слишком много неверных кодов за последний час. Попробуйте позже и уточните индивидуальный код в управляющей компании.', mainMenuLinkButtons());
          return true;
        }
        await this.messenger.sendMessageToUser(maxUserId, `Индивидуальный код не подошёл. Проверьте его и попробуйте ещё раз. Осталось попыток: ${left}.`);
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
      const complete = parseDraft({ ...data, description, photos: [...(data.photos ?? []), ...images].slice(0, 3) });
      if (!complete) {
        await prisma.botSession.deleteMany({ where: { userId: user.id } });
        await this.sendStaleDialog(maxUserId);
        return true;
      }
      await this.saveSession(user.id, 'ready_submit', complete);
      await this.messenger.sendMessageToUser(maxUserId, 'Описание принято. Теперь можете добавить фото или отправить заявку без фото.', [
        [{ text: 'Добавить фото', payload: 'incident:new-photo' }],
        [{ text: 'Отправить без фото', payload: 'incident:submit', intent: 'positive' }],
        [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
      ]);
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

    // Without a connected apartment only reference sections and the address
    // steps are open; every other button leads to the resident's home screen
    // (waiting for approval or choosing a building), never to the full menu.
    if (!opensWithoutAddress(payload) && !await this.getMembership(user.id)) {
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.showHome(maxUserId, user.id);
      return true;
    }

    if (payload === 'menu:main') {
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.showMainMenu(maxUserId);
      return true;
    }
    const listMatch = payload.match(/^incidents:(list|archive|general)(?::page:(\d{1,4}))?$/);
    if (listMatch) {
      const page = Number(listMatch[2] ?? '1');
      if (listMatch[1] === 'general') await this.showGeneralIncidents(maxUserId, user.id, page);
      else await this.showMyIncidents(maxUserId, user.id, listMatch[1] === 'archive', page);
      return true;
    }
    if (payload === 'bot:info') {
      await this.showBotInfo(maxUserId);
      return true;
    }
    if (payload === 'polls:list') {
      await this.showPolls(maxUserId, user.id);
      return true;
    }
    if (payload.startsWith('poll:open:')) {
      const pollId = payload.slice('poll:open:'.length);
      if (!z.string().uuid().safeParse(pollId).success) return false;
      await this.showPoll(maxUserId, user.id, pollId);
      return true;
    }
    const pollVote = /^poll:vote:([0-9a-f-]{36}):([\w-]{1,20})$/.exec(payload);
    if (pollVote) {
      const result = await castVote(user.id, pollVote[1]!, pollVote[2]!);
      const notice = result.ok ? 'Голос учтён.' : ({ poll_closed: 'Опрос уже завершён.', vote_final: 'В этом опросе голос нельзя изменить.', poll_not_found: 'Опрос недоступен.', residence_required: 'Сначала подключитесь к квартире.' } as Record<string, string>)[result.code] ?? 'Не удалось проголосовать.';
      await this.showPoll(maxUserId, user.id, pollVote[1]!, notice);
      return true;
    }
    if (payload === 'uk:duties') {
      await this.showDuties(maxUserId);
      return true;
    }
    if (payload === 'emergency:services') {
      await this.showEmergencyServices(maxUserId);
      return true;
    }
    if (payload === 'neighbors:menu') {
      await this.showNeighborsMenu(maxUserId, user.id);
      return true;
    }
    if (payload === 'uk:contacts') {
      await this.showUkContacts(maxUserId);
      return true;
    }
    if (payload === 'announcements:list' || payload.startsWith('announcements:page:')) {
      const page = payload === 'announcements:list' ? 1 : Number(payload.slice('announcements:page:'.length));
      if (!Number.isInteger(page) || page < 1 || page > 1000) return false;
      await this.showAnnouncements(maxUserId, user.id, page);
      return true;
    }
    if (payload.startsWith('announcements:view:')) {
      const announcementId = payload.slice('announcements:view:'.length);
      if (!z.string().uuid().safeParse(announcementId).success) return false;
      await this.showAnnouncement(maxUserId, user.id, announcementId);
      return true;
    }
    if (payload.startsWith('apartment:clear:')) {
      const apartmentId = payload.slice('apartment:clear:'.length);
      if (!z.string().uuid().safeParse(apartmentId).success) return false;
      await this.clearPreviousApartment(maxUserId, user.id, apartmentId);
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
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold('Отвязаться от квартиры?'), `${membership.apartment.building.address}, кв. ${membership.apartment.number}`],
        ['Вы останетесь в боте, но заявки и данные квартиры будут недоступны, пока вы снова не выберете квартиру.'],
      ), [
        [{ text: 'Да, отвязаться', payload: 'apartment:leave:confirm', intent: 'negative' }],
        [{ text: 'Отмена', payload: 'apartment:change' }],
      ]);
      return true;
    }
    if (payload === 'apartment:leave:confirm') {
      const previous = await this.getMembership(user.id);
      // The button may come from an old message after the resident already
      // left: then there is nothing to do but offer to pick an apartment.
      if (!previous) { await this.askApartmentCode(maxUserId, user.id); return true; }
      const removed = await prisma.$transaction((tx) => leaveApartment(tx, user.id, previous.apartmentId));
      const lines = ['Привязка к квартире удалена, согласие на обработку данных отозвано: телефон и автомобили стёрты. Чтобы снова пользоваться заявками, выберите дом и подтвердите квартиру.'];
      if (removed.stoppedSubscriptions) lines.push(`Уведомления по заявкам прежнего адреса отключены: ${removed.stoppedSubscriptions}. Сами заявки остались в архиве «Мои заявки».`);
      const buttons: CallbackButton[][] = [[{ text: 'Выбрать квартиру', payload: 'apartment:change', intent: 'positive' }]];
      if (await canClearApartmentData(user.id, previous.apartmentId)) {
        lines.push('В профиле прежней квартиры остались ФИО, телефоны или автомобили. Новые жильцы смогут их увидеть — их можно удалить.');
        buttons.unshift([{ text: 'Очистить данные прежней квартиры', payload: `apartment:clear:${previous.apartmentId}`, intent: 'negative' }]);
      }
      await this.messenger.sendMessageToUser(maxUserId, lines.join('\n\n'), buttons);
      return true;
    }
    if (payload === 'car:search') {
      await this.saveSession(user.id, 'car_search', {});
      await this.messenger.sendMessageToUser(maxUserId, 'Введите номер машины, например А123ВС.', flowButtons());
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
      const me = await prisma.user.findUnique({ where: { id: user.id }, select: { sharedPhone: true } });
      await this.showCars(maxUserId, user.id, membership.apartmentId, me?.sharedPhone || profile.phones.length
        ? 'Телефон будет показан соседу, который ищет вашу машину.'
        : 'Показ включён. Чтобы соседу было куда звонить, поделитесь номером в «Моя квартира» или укажите телефон владельца машины.');
      return true;
    }
    if (payload === 'profile:phone-consent:no') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      await prisma.residentProfile.updateMany({ where: { apartmentId: membership.apartmentId }, data: { phoneConsentAt: null, phoneVisibility: 'hidden' } });
      await this.showCars(maxUserId, user.id, membership.apartmentId, 'Телефон при поиске авто скрыт.');
      return true;
    }
    if (payload === 'profile:visibility') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      // Showing phones requires an explicit answer to the consent question.
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold('Показывать телефон при поиске авто?')],
        ['Если сосед найдёт вашу машину по госномеру, он увидит телефон владельца машины, а если его нет — номер жителя квартиры из MAX.'],
        ['Разрешайте, только если владельцы этих номеров согласны.'],
      ), [
        [{ text: 'Разрешить показ', payload: 'profile:phone-consent:yes', intent: 'positive' }],
        [{ text: 'Оставить скрытым', payload: 'profile:phone-consent:no' }],
      ]);
      return true;
    }
    if (payload === 'profile:residents') {
      await this.saveSession(user.id, 'profile_residents', {});
      const membership = await this.getMembership(user.id);
      const listed = membership ? await this.countKnownResidents(membership.apartmentId) : 0;
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold('Сколько человек проживает')],
        ['Напишите, сколько человек живёт в квартире всего — включая тех, кого нет ни в боте, ни в списке «Другие жильцы».'],
        [`Сейчас известно: ${listed} (жители в боте и «Другие жильцы»). Если это все, менять ничего не нужно.`],
      ), [[{ text: 'Отмена', payload: 'hh:people' }]]);
      return true;
    }
    if (payload.startsWith('hh:')) return this.handleHousehold(maxUserId, user.id, payload);
    if (payload === 'apartment:change') {
      const membership = await this.getMembership(user.id);
      if (!membership) { await this.askApartmentCode(maxUserId, user.id); return true; }
      // One entry point for both cases: moving to a new address or simply
      // leaving the apartment without a new one.
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold('Сменить адрес или отвязаться'), `Сейчас: ${membership.apartment.building.address}, кв. ${membership.apartment.number}`],
        [html`${bold('Переехали')} — выберите новый дом и квартиру. Уведомления по заявкам прежнего адреса отключатся, сами заявки останутся в архиве «Мои заявки».`],
        [html`${bold('Больше не живёте здесь')} — отвяжитесь без нового адреса. Бот останется, но заявки и данные квартиры будут недоступны, пока вы снова не выберете квартиру.`],
        ['В обоих случаях бот предложит удалить данные прежней квартиры, если там больше никто не подключён.'],
      ), [
        [{ text: 'Выбрать новый дом и квартиру', payload: 'apartment:change:confirm', intent: 'positive' }],
        [{ text: 'Отвязаться без нового адреса', payload: 'apartment:leave', intent: 'negative' }],
        [{ text: 'Отмена', payload: 'profile:view' }],
      ]);
      return true;
    }
    if (payload === 'apartment:change:confirm') {
      await this.askApartmentCode(maxUserId, user.id);
      return true;
    }
    if (payload === 'address:search') {
      await this.askAddressSearch(maxUserId, user.id, await this.sessionCity(user.id));
      return true;
    }
    if (payload === 'address:browse') {
      await this.askApartmentCode(maxUserId, user.id, true, await this.sessionCity(user.id));
      return true;
    }
    if (payload === 'desk:web') {
      // A company employee or the platform administrator opens the web desk
      // without a password: MAX already told who they are.
      const admin = await prisma.admin.findUnique({ where: { maxUserId }, select: { id: true, companyId: true, role: true } });
      const platform = admin?.role === 'platform_admin';
      if (!admin || (!admin.companyId && !platform)) {
        await this.messenger.sendMessageToUser(maxUserId, 'Веб-диспетчерская открывается сотрудникам УК.', mainMenuLinkButtons());
        return true;
      }
      const url = await createWebLoginLink(admin.id);
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold(platform ? 'Веб-админка платформы' : 'Веб-диспетчерская УК')],
        ['Ссылка одноразовая и действует 5 минут. Откройте её на компьютере или в браузере телефона.'],
      ), [[{ text: platform ? 'Открыть веб-админку' : 'Открыть веб-диспетчерскую', payload: 'desk:web:open', url }], [{ text: 'В главное меню', payload: 'menu:main' }]]);
      return true;
    }
    if (payload === 'staff:reminders' || payload === 'staff:reminders:on' || payload === 'staff:reminders:off') {
      await this.showLegalReminders(maxUserId, payload === 'staff:reminders' ? undefined : payload === 'staff:reminders:on');
      return true;
    }
    if (payload === 'city:change') {
      await this.showCityChoice(maxUserId, user.id);
      return true;
    }
    if (payload.startsWith('city:choose:')) {
      const anchorId = payload.slice('city:choose:'.length);
      if (!z.string().uuid().safeParse(anchorId).success) return false;
      const anchor = await prisma.building.findUnique({ where: { id: anchorId }, select: { city: true } });
      if (!anchor?.city) { await this.showCityChoice(maxUserId, user.id); return true; }
      await this.askApartmentCode(maxUserId, user.id, false, anchor.city);
      return true;
    }
    if (payload.startsWith('street:choose:')) {
      const [anyBuildingId, pageText] = payload.slice('street:choose:'.length).split(':');
      const page = Number(pageText ?? '1');
      if (!anyBuildingId || !z.string().uuid().safeParse(anyBuildingId).success || !Number.isInteger(page)) return false;
      await this.showStreetHouses(maxUserId, user.id, anyBuildingId, page);
      return true;
    }
    if (payload.startsWith('building:choose:')) {
      const buildingId = payload.slice('building:choose:'.length);
      if (!z.string().uuid().safeParse(buildingId).success) return false;
      const building = await prisma.building.findUnique({ where: { id: buildingId }, select: { id: true, address: true } });
      if (!building) return false;
      // Before the first apartment: consent to the processing of personal data.
      if (!(await prisma.user.findUnique({ where: { id: user.id }, select: { consentAt: true } }))?.consentAt) {
        await this.askConsent(maxUserId, building.id);
        return true;
      }
      await this.saveSession(user.id, 'apartment_number', { buildingId: building.id });
      await this.messenger.sendMessageToUser(maxUserId, `${building.address}\nВведите номер своей квартиры цифрами.` , await this.addressButtons(user.id, 'inside'));
      return true;
    }
    if (payload.startsWith('consent:accept:')) {
      const buildingId = payload.slice('consent:accept:'.length);
      if (!z.string().uuid().safeParse(buildingId).success) return false;
      await prisma.user.update({ where: { id: user.id }, data: { consentAt: new Date() } });
      const building = await prisma.building.findUnique({ where: { id: buildingId }, select: { id: true, address: true } });
      if (!building) { await this.showHome(maxUserId, user.id); return true; }
      await this.saveSession(user.id, 'apartment_number', { buildingId: building.id });
      await this.messenger.sendMessageToUser(maxUserId, `${building.address}\nВведите номер своей квартиры цифрами.`, await this.addressButtons(user.id, 'inside'));
      return true;
    }
    // The answer of a resident after "resolved": confirm and rate, or return.
    const feedbackMatch = /^incident:(accept|rate|reopen|reopen-now):([0-9a-f-]{36})(?::([1-5]))?$/.exec(payload);
    if (feedbackMatch) return this.handleFeedback(maxUserId, user.id, feedbackMatch[1]!, feedbackMatch[2]!, feedbackMatch[3] ? Number(feedbackMatch[3]) : undefined);
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
      await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Комментарий к заявке')], ['Напишите текст комментария. Его увидят жители этого дома и УК. Удалить свой комментарий можно будет в карточке заявки.']), [[{ text: 'Отмена', payload: `incident:view:${incidentId}` }]]);
      return true;
    }
    if (payload.startsWith('join:approve:') || payload.startsWith('join:reject:')) {
      const approve = payload.startsWith('join:approve:');
      const requestId = payload.slice(approve ? 'join:approve:'.length : 'join:reject:'.length);
      if (!z.string().uuid().safeParse(requestId).success) return false;
      const result = await decideJoinRequest(requestId, approve ? 'approve' : 'reject', { userId: user.id });
      if (!result.ok) {
        const reasons = {
          not_found: 'Этот запрос больше не существует.',
          already_decided: 'По этому запросу уже принято решение: его подтвердил или отклонил другой житель квартиры, либо человек сам отменил запрос.',
          expired: 'Запрос устарел: на него не ответили неделю. Если человек снова попросится в квартиру, придёт новый запрос.',
          not_allowed: 'Подтверждать подключение могут только жители этой квартиры.',
        };
        await this.messenger.sendMessageToUser(maxUserId, reasons[result.reason], mainMenuLinkButtons());
        return true;
      }
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold(result.status === 'approved' ? 'Подключение подтверждено' : 'Запрос отклонён'), result.address],
        [result.status === 'approved'
          ? `${result.requesterName} теперь подключён к квартире ${result.apartmentNumber}. Ему пришло сообщение об этом.`
          : `${result.requesterName} не будет подключён. Ему пришло сообщение, что запрос отклонён.`],
      ), mainMenuLinkButtons());
      return true;
    }
    if (payload === 'join:cancel') {
      await cancelJoinRequest(user.id);
      if (await this.getMembership(user.id)) await this.showMainMenu(maxUserId);
      else await this.askApartmentCode(maxUserId, user.id);
      return true;
    }
    if (payload === 'join:status') {
      await this.showJoinWaiting(maxUserId, user.id);
      return true;
    }
    if (payload === 'contact:remove') {
      await prisma.user.update({ where: { id: user.id }, data: { sharedPhone: null, phoneSharedAt: null } });
      await this.showProfile(maxUserId, user.id, 'Номер убран: жители квартиры и УК его больше не видят.');
      return true;
    }
    if (payload.startsWith('comments:mine:')) {
      const incidentId = payload.slice('comments:mine:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      await this.showOwnComments(maxUserId, user.id, incidentId);
      return true;
    }
    if (payload.startsWith('comment:delete:') || payload.startsWith('comment:delete-yes:')) {
      const confirmed = payload.startsWith('comment:delete-yes:');
      const commentId = payload.slice(confirmed ? 'comment:delete-yes:'.length : 'comment:delete:'.length);
      if (!z.string().uuid().safeParse(commentId).success) return false;
      const comment = await prisma.incidentComment.findFirst({ where: { id: commentId, authorUserId: user.id }, select: { id: true, text: true, incidentId: true } });
      if (!comment) {
        await this.messenger.sendMessageToUser(maxUserId, 'Комментарий уже удалён.', mainMenuLinkButtons());
        return true;
      }
      if (!confirmed) {
        await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Удалить комментарий?')], [`«${preview(comment.text, 300)}»`], ['Соседи и УК перестанут его видеть.']), [
          [{ text: 'Да, удалить', payload: `comment:delete-yes:${comment.id}`, intent: 'negative' }],
          [{ text: 'Отмена', payload: `comments:mine:${comment.incidentId}` }],
        ]);
        return true;
      }
      await prisma.incidentComment.deleteMany({ where: { id: comment.id, authorUserId: user.id } });
      await this.showIncident(maxUserId, user.id, comment.incidentId);
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
      if (!await this.hasCurrentAddressReport(user.id, incidentId)) { await this.messenger.sendMessageToUser(maxUserId, 'Обращение относится к прежнему адресу, поэтому его нельзя изменить.', mainMenuLinkButtons()); return true; }
      const result = await cancelResidentReport(user.id, incidentId);
      await this.messenger.sendMessageToUser(maxUserId, result
        ? result.reportsLeft === 0 ? 'Обращение отменено. Так как других обращений не осталось, заявка отправлена в архив.' : 'Ваше обращение отменено. Заявка остаётся активной для других жителей.'
        : 'Эту заявку уже нельзя отменить.', mainMenuLinkButtons());
      return true;
    }
    if (payload.startsWith('incident:photo:add:')) {
      const incidentId = payload.slice('incident:photo:add:'.length);
      if (!z.string().uuid().safeParse(incidentId).success) return false;
      if (!await this.hasCurrentAddressReport(user.id, incidentId)) { await this.messenger.sendMessageToUser(maxUserId, 'Обращение относится к прежнему адресу, поэтому к нему нельзя добавить фото.', mainMenuLinkButtons()); return true; }
      await this.saveSession(user.id, 'add_photo', { incidentId });
      await this.messenger.sendMessageToUser(maxUserId, 'Пришлите фото проблемы. Можно добавить до 3 фото от одного жителя и до 9 на заявку.', flowButtons());
      return true;
    }
    if (payload === 'incident:new-photo' || payload === 'incident:submit') {
      const session = await prisma.botSession.findUnique({ where: { userId: user.id } });
      const draft = session && session.expiresAt >= new Date() ? parseDraft(session.data) : null;
      if (!session || !draft || !['description', 'new_photos', 'ready_submit', 'matching'].includes(session.step)) {
        await this.sendStaleDialog(maxUserId);
        return true;
      }
      if (payload === 'incident:new-photo') {
        await this.saveSession(user.id, 'new_photos', draft);
        await this.messenger.sendMessageToUser(maxUserId, 'Пришлите до 3 фото одним или несколькими сообщениями.', flowButtons());
        return true;
      }
      await this.submitDraft(maxUserId, user.id, draft);
      return true;
    }

    if (payload === 'flow:cancel') {
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.showMainMenu(maxUserId);
      return true;
    }

    const session = await prisma.botSession.findUnique({ where: { userId: user.id } });
    const parsedSession = session ? sessionDataSchema.safeParse(session.data) : null;
    if (!session || session.expiresAt < new Date() || !parsedSession?.success) {
      await this.sendStaleDialog(maxUserId);
      return true;
    }
    const data = parsedSession.data;

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
      // Only the places where such a problem can be; one place is not asked.
      const zones = zonesByCategory[category];
      if (zones.length === 1) {
        const only = zones[0]!;
        if (only === 'entrance' || only === 'elevator') await this.askEntrance(maxUserId, user.id, { ...next, locationZone: only });
        else await this.askDescription(maxUserId, user.id, { ...next, locationZone: only });
        return true;
      }
      const zoneButtons = zones.map((zone) => ({ text: zoneButtonLabels[zone], payload: `zone:${zone}` }));
      const zoneRows: CallbackButton[][] = [];
      for (let index = 0; index < zoneButtons.length; index += 2) zoneRows.push(zoneButtons.slice(index, index + 2));
      await this.saveSession(user.id, 'zone', next);
      await this.messenger.sendMessageToUser(maxUserId, 'Где возникла проблема?', [...zoneRows, ...flowButtons()]);
      return true;
    }

    if (payload.startsWith('zone:')) {
      const zone = payload.slice('zone:'.length);
      if (!zoneLabels[zone]) return false;
      if (data.category && !(zonesByCategory[data.category] as string[]).includes(zone)) return false;
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

    if (payload === 'incident:new' || payload.startsWith('incident:join:')) {
      const draft = session.step === 'matching' ? parseDraft(data) : null;
      if (!draft) {
        await this.sendStaleDialog(maxUserId);
        return true;
      }
      if (payload.startsWith('incident:join:')) return this.joinMatchingIncident(maxUserId, user.id, payload.slice('incident:join:'.length), draft);
      const incident = await createIncidentFromReport(user.id, draft);
      await prisma.botSession.deleteMany({ where: { userId: user.id } });
      await this.messenger.sendMessageToUser(
        maxUserId,
        `Создана отдельная заявка № ${incident.number}.`,
        mainMenuLinkButtons(),
      );
      return true;
    }

    return false;
  }

  private async joinMatchingIncident(maxUserId: string, userId: string, incidentId: string, draft: IncidentDraft): Promise<boolean> {
    if (!z.string().uuid().safeParse(incidentId).success) return false;
    let result: Awaited<ReturnType<typeof joinIncident>>;
    try {
      result = await joinIncident(userId, incidentId, draft);
    } catch {
      // The incident may have been closed after the matches were shown. Keep the
      // draft so the resident can still create a separate incident.
      await this.messenger.sendMessageToUser(maxUserId, 'К этой заявке уже нельзя присоединиться. Можно создать отдельную заявку.', [
        [{ text: 'Создать отдельную заявку', payload: 'incident:new', intent: 'positive' }],
        [{ text: 'В главное меню', payload: 'menu:main' }],
      ]);
      return true;
    }
    await prisma.botSession.deleteMany({ where: { userId } });
    const text = result.alreadyJoined
      ? `Вы уже присоединены к заявке № ${result.incident.number}. Повторное обращение не добавлено.`
      : `Вы присоединились к заявке № ${result.incident.number} и будете получать обновления.`;
    await this.messenger.sendMessageToUser(maxUserId, text, mainMenuLinkButtons());
    return true;
  }

  private async handleFeedback(maxUserId: string, userId: string, action: string, incidentId: string, rating?: number): Promise<boolean> {
    if (!z.string().uuid().safeParse(incidentId).success) return false;
    if (action === 'reopen') {
      const incident = await prisma.incident.findFirst({ where: { id: incidentId, reports: { some: { authorUserId: userId } } }, select: { id: true, number: true, status: true, resolvedAt: true } });
      if (!incident || !feedbackOpen(incident)) { await this.answerFeedback(maxUserId, incidentId, { ok: false, code: incident ? 'feedback_closed' : 'incident_not_found' }); return true; }
      await this.saveSession(userId, 'reopen_reason', { incidentId });
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold(`Заявка № ${incident.number}: проблема не решена`)],
        ['Напишите одним сообщением, что осталось не так, — диспетчер увидит это вместе с заявкой.'],
        ['Или верните заявку в работу без описания.'],
      ), [
        [{ text: 'Вернуть без описания', payload: `incident:reopen-now:${incident.id}`, intent: 'negative' }],
        [{ text: 'Отмена', payload: `incident:view:${incident.id}` }],
      ]);
      return true;
    }
    await prisma.botSession.deleteMany({ where: { userId } });
    const result = await giveFeedback(userId, incidentId, action === 'reopen-now' ? { resolved: false } : { resolved: true, ...(rating ? { rating } : {}) });
    await this.answerFeedback(maxUserId, incidentId, result, action === 'accept' ? 'ask_rating' : rating);
    return true;
  }

  private async answerFeedback(maxUserId: string, incidentId: string, result: FeedbackResult, next?: 'ask_rating' | number) {
    const back: CallbackButton[][] = [[{ text: 'Открыть заявку', payload: `incident:view:${incidentId}` }], ...mainMenuLinkButtons()];
    if (!result.ok) {
      await this.messenger.sendMessageToUser(maxUserId, result.code === 'incident_not_found'
        ? 'Заявка не найдена или больше вам недоступна.'
        : 'Ответ по этой заявке уже не принимается: она снова в работе или закрыта больше 14 дней назад. Если проблема вернулась, сообщите о ней заново.', back);
      return;
    }
    if (result.reopened) {
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold(`Заявка № ${result.number} снова в работе`)],
        ['Управляющая компания получила уведомление. Новый статус и ответ придут сюда.'],
      ), back);
      return;
    }
    if (next === 'ask_rating') {
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold('Спасибо, что подтвердили!')],
        ['Оцените, пожалуйста, работу УК по этой заявке: 5 — отлично, 1 — плохо.'],
      ), [
        [1, 2, 3, 4, 5].map((value) => ({ text: String(value), payload: `incident:rate:${incidentId}:${value}` })),
        [{ text: 'Без оценки', payload: 'menu:main' }],
      ]);
      return;
    }
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Спасибо за оценку!')],
      [typeof next === 'number' ? `${'★'.repeat(next)}${'☆'.repeat(5 - next)} — оценка сохранена. Она помогает УК работать лучше.` : 'Ответ сохранён.'],
    ), back);
  }

  async sendStaleDialog(maxUserId: string) {
    await this.messenger.sendMessageToUser(maxUserId, 'Диалог устарел. Выберите действие в главном меню.', mainMenuLinkButtons());
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
    await this.messenger.sendMessageToUser(maxUserId, 'Сообщение о проблеме попадёт в управляющую компанию. Если такая заявка уже есть, можно присоединиться к ней — это повысит её приоритет.\n\nВыберите категорию проблемы:', rows);
  }

  private async submitDraft(maxUserId: string, userId: string, draft: IncidentDraft) {
    const completeDraft = { ...draft, photos: draft.photos ?? [] };
    const matches = await findMatchingIncidents(userId, completeDraft);
    if (matches.length === 0) {
      const incident = await createIncidentFromReport(userId, completeDraft);
      await prisma.botSession.deleteMany({ where: { userId } });
      await this.messenger.sendMessageToUser(maxUserId, `Готово. Создана новая заявка № ${incident.number}. Вы получите уведомления об изменениях.`, mainMenuLinkButtons());
      return;
    }
    await this.saveSession(userId, 'matching', completeDraft);
    const buttons: CallbackButton[][] = [
      ...matches.map((match) => [{ text: `Присоединиться к № ${match.number}`, payload: `incident:join:${match.id}`, intent: 'positive' as const }]),
      [{ text: 'Это другая проблема', payload: 'incident:new', intent: 'default' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ];
    for (const match of matches) if (match.photos.length) await this.messenger.sendMessageToUser(maxUserId, `Фото к похожей заявке № ${match.number}:`, [], toMessengerImages(match.photos));
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Похожие заявки уже есть')],
      ...matches.map((match) => [
        html`${bold(`№ ${match.number}`)} — ${match.title}`,
        `Обратились: ${match._count.reports} ${plural(match._count.reports, 'житель', 'жителя', 'жителей')}`,
      ]),
      ['Если это та же проблема, присоединитесь: заявка поднимется выше, а вы получите уведомления. Если нет — создайте новую.'],
    ), buttons);
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
    // "Водоснабжение, весь дом", "Уборка, лифт, подъезд 2", "Лифт, подъезд 1".
    const category = data.category ? categoryLabels[data.category] : null;
    const zone = data.affectedApartmentNumber
      ? `квартира ${data.affectedApartmentNumber}`
      : data.locationZone === 'common'
      ? 'весь дом'
      : data.locationZone === 'entrance' && data.entranceNumber
      ? null
      : zoneLabels[data.locationZone ?? '']?.toLowerCase() ?? null;
    const place = [category, zone === category?.toLowerCase() ? null : zone, data.entranceNumber ? `подъезд ${data.entranceNumber}` : null].filter(Boolean).join(', ');
    await this.messenger.sendMessageToUser(maxUserId, `Опишите проблему. Выбрано: ${place}. Фото можно приложить позднее, уже после создания заявки.`, [
      [{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }],
    ]);
  }

  private async askApartmentMessageText(maxUserId: string, userId: string, data: Pick<SessionData, 'recipientApartmentId' | 'recipientApartmentNumber'>, prompt?: string) {
    await this.saveSession(userId, 'resident_message_text', data);
    await this.messenger.sendMessageToUser(maxUserId, prompt ?? `Напишите сообщение квартире ${data.recipientApartmentNumber}.`, flowButtons());
  }

  // Few buildings: one list. More buildings: street first, then the house.
  // Many streets: the resident types a part of the street name.
  private async askAddressSearch(maxUserId: string, userId: string, city?: string) {
    await this.saveSession(userId, 'building_search', city ? { city } : {});
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold(city ? `Поиск дома: ${city}` : 'Поиск дома')],
      ['Напишите улицу и номер дома так, как удобно: «садовая 7», «Мира 12», «7 к1 садовая». «Ул.», «д.» и регистр букв можно не писать.'],
    ), [[{ text: 'Показать список домов', payload: 'address:browse' }], ...await this.addressButtons(userId, 'list')]);
  }

  // Looking for a house: the city first (when houses are in several cities),
  // then the street in it, then the house.
  private async askApartmentCode(maxUserId: string, userId: string, browse = false, city?: string) {
    if (!city) {
      const cities = await this.connectedCities();
      if (cities.length > 1) { await this.showCityChoice(maxUserId, userId, cities); return; }
    }
    const where = city ? { city } : {};
    const buildings = await prisma.building.findMany({ where, select: buildingChoiceSelect, take: buildingButtonsLimit + 1 });
    if (buildings.length === 0) {
      await this.saveSession(userId, 'building_choice', {});
      await this.messenger.sendMessageToUser(maxUserId, 'Дома пока не добавлены управляющей компанией.');
      return;
    }
    if (buildings.length <= buildingButtonsLimit) {
      await this.showBuildingChoice(maxUserId, userId, buildings.sort(compareBuildings), 'Выберите свой дом:', city);
      return;
    }
    const streets = await prisma.building.findMany({ where, distinct: ['street'], select: { id: true, street: true }, take: buildingButtonsLimit + 1 });
    if (streets.length <= buildingButtonsLimit) {
      await this.showStreetChoice(maxUserId, userId, streets.sort((left, right) => left.street.localeCompare(right.street, 'ru', { numeric: true })), 'Выберите свою улицу:', city);
      return;
    }
    if (browse) {
      await this.showStreetChoice(maxUserId, userId, (await prisma.building.findMany({ where, distinct: ['street'], select: { id: true, street: true } })).sort((left, right) => left.street.localeCompare(right.street, 'ru', { numeric: true })).slice(0, buildingButtonsLimit), 'Улицы с подключёнными домами (первые 20 по алфавиту):', city);
      return;
    }
    await this.askAddressSearch(maxUserId, userId, city);
  }

  // Cities with connected houses, the biggest first. A button carries the id
  // of any house of the city: a city name can be longer than a payload allows.
  private async connectedCities() {
    const groups = await prisma.building.groupBy({ by: ['city'], where: { city: { not: null } }, _count: { _all: true } });
    const cities = await Promise.all(groups.map(async (group) => ({
      city: group.city!,
      count: group._count._all,
      anchorId: (await prisma.building.findFirst({ where: { city: group.city }, select: { id: true } }))!.id,
    })));
    return cities.sort((left, right) => right.count - left.count || left.city.localeCompare(right.city, 'ru'));
  }

  private async showCityChoice(maxUserId: string, userId: string, known?: Array<{ city: string; count: number; anchorId: string }>) {
    const cities = known ?? await this.connectedCities();
    if (cities.length <= 1) { await this.askApartmentCode(maxUserId, userId, false, cities[0]?.city); return; }
    await this.saveSession(userId, 'building_choice', {});
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Ваш город')],
      ['Выберите город — дальше покажем улицы и дома в нём.'],
      [menuLater],
    ), [
      ...cities.slice(0, buildingButtonsLimit).map((item) => [{ text: `${item.city} — ${item.count} ${pluralHouses(item.count)}`, payload: `city:choose:${item.anchorId}` }]),
      [{ text: 'Найти дом на карте', payload: 'map', openApp: true }],
      ...(await this.addressButtons(userId, 'list')),
      ...await deskButton(maxUserId),
    ]);
  }

  private async sessionCity(userId: string) {
    const session = await prisma.botSession.findUnique({ where: { userId }, select: { data: true } });
    const parsed = session ? sessionDataSchema.safeParse(session.data) : null;
    return parsed?.success ? parsed.data.city : undefined;
  }

  private async showBuildingChoice(maxUserId: string, userId: string, buildings: Array<{ id: string; address: string }>, text: string, city?: string) {
    await this.saveSession(userId, 'building_choice', city ? { city } : {});
    // Houses one per row; actions two per row below them, so the list and
    // the actions read as two blocks.
    await this.messenger.sendMessageToUser(
      maxUserId,
      blocks([bold(city ?? 'Выбор дома')], [text], ['Нет в списке? Найдите по адресу или на карте.'], await this.menuLaterLine(userId)),
      [
        ...buildings.map((building) => [{ text: building.address, payload: `building:choose:${building.id}` }]),
        [{ text: 'Найти по адресу', payload: 'address:search' }, ...(city ? [{ text: 'Другой город', payload: 'city:change' }] : [])],
        [{ text: 'Найти дом на карте', payload: 'map', openApp: true }],
        ...(await this.addressButtons(userId, 'list')),
      ],
    );
  }

  // A street button carries the id of any building on it: street names can be
  // longer than a button payload allows.
  private async showStreetChoice(maxUserId: string, userId: string, streets: Array<{ id: string; street: string }>, text: string, city?: string) {
    await this.saveSession(userId, 'building_choice', city ? { city } : {});
    await this.messenger.sendMessageToUser(maxUserId, blocks([bold(city ?? 'Выбор улицы')], [text]), [
      ...streets.map((item) => [{ text: item.street, payload: `street:choose:${item.id}:1` }]),
      [{ text: 'Найти по адресу', payload: 'address:search' }, ...(city ? [{ text: 'Другой город', payload: 'city:change' }] : [])],
      ...(await this.addressButtons(userId, 'list')),
    ]);
  }

  private async showStreetHouses(maxUserId: string, userId: string, anyBuildingId: string, page: number) {
    const anchor = await prisma.building.findUnique({ where: { id: anyBuildingId }, select: { street: true, city: true } });
    if (!anchor) { await this.askApartmentCode(maxUserId, userId); return; }
    // The same street name in two cities is two different streets.
    const houses = (await prisma.building.findMany({ where: { street: anchor.street, city: anchor.city }, select: buildingChoiceSelect })).sort(compareBuildings);
    const pages = Math.max(1, Math.ceil(houses.length / housesPerPage));
    const current = Math.min(Math.max(page, 1), pages);
    const visible = houses.slice((current - 1) * housesPerPage, current * housesPerPage);
    const rows: CallbackButton[][] = [];
    for (let index = 0; index < visible.length; index += 2) {
      rows.push(visible.slice(index, index + 2).map((building) => ({ text: building.house ? `дом ${building.house}` : building.address, payload: `building:choose:${building.id}` })));
    }
    const navigation: CallbackButton[] = [
      ...(current > 1 ? [{ text: 'Предыдущие дома', payload: `street:choose:${anyBuildingId}:${current - 1}` }] : []),
      ...(current < pages ? [{ text: 'Следующие дома', payload: `street:choose:${anyBuildingId}:${current + 1}` }] : []),
    ];
    if (navigation.length) rows.push(navigation);
    rows.push([{ text: 'Найти по адресу', payload: 'address:search' }, { text: 'Другая улица', payload: 'address:browse' }]);
    await this.saveSession(userId, 'building_choice', anchor.city ? { city: anchor.city } : {});
    await this.messenger.sendMessageToUser(maxUserId, blocks([bold(anchor.street)], [anchor.city ?? ''], [`Выберите номер дома${pages > 1 ? ` (страница ${current} из ${pages})` : ''}:`]), [...rows, ...(await this.addressButtons(userId, 'list'))]);
  }

  // The one and only main menu: always the same full message, wherever the
  // resident comes from, so the chat never shows a short and a long variant.
  // The home screen of a resident without an apartment: the open join request
  // if there is one, otherwise choosing a building.
  private async showHome(maxUserId: string, userId: string) {
    if (await pendingJoinRequest(userId)) await this.showJoinWaiting(maxUserId, userId);
    else await this.askApartmentCode(maxUserId, userId);
  }

  private async showMainMenu(maxUserId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { maxUserId } });
    const membership = await this.getMembership(user.id);
    // Without an apartment the menu is the choice of a house, in the same
    // message: the screen says why the menu is not there yet.
    if (!membership) {
      await this.showHome(maxUserId, user.id);
      return;
    }
    const building = membership?.apartment.building;
    await this.messenger.sendMessageToUser(
      maxUserId,
      blocks(
        [
          bold('Главное меню'),
          membership ? `${membership.apartment.building.address}, кв. ${membership.apartment.number}` : null,
          membership ? (building?.chatLink ? 'Чат дома — по кнопке ниже' : 'Чат дома пока не создан') : null,
        ],
        ['Здесь можно сообщить о проблеме в управляющую компанию, следить за своими заявками и заявками дома, читать объявления УК и связаться с соседями.'],
        ['Если вы здесь впервые, загляните в «Возможности бота» — там коротко о каждом разделе.'],
      ),
      [...mainMenuButtons(), ...(building?.chatLink ? [[{ text: 'Чат дома', payload: 'chat:open', url: building.chatLink }]] : []), ...await deskButton(maxUserId)],
    );
  }

  private async showProfile(maxUserId: string, userId: string, notice?: string) {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.showHome(maxUserId, userId); return; }
    const apartmentId = membership.apartmentId;
    const [profile, people, vehicles, connected] = await Promise.all([
      prisma.residentProfile.findUnique({ where: { apartmentId }, select: { residentsCount: true, phoneVisibility: true } }),
      prisma.residentPerson.findMany({ where: { isVehicleOwner: false, profile: { apartmentId } }, orderBy: { fullName: 'asc' } }),
      prisma.vehicle.findMany({ where: { apartmentId }, select: { licensePlate: true, owner: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } }),
      prisma.residentMembership.findMany({ where: { apartmentId, revokedAt: null }, orderBy: { verifiedAt: 'asc' }, select: { user: { select: { id: true, displayName: true, maxUsername: true, sharedPhone: true } } } }),
    ]);
    await prisma.botSession.deleteMany({ where: { userId } });
    const me = connected.find(({ user }) => user.id === userId)?.user;
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      notice ? [bold(notice)] : [],
      [bold('Моя квартира'), `Адрес: ${membership.apartment.building.address}`, `Квартира: ${membership.apartment.number}`, residentsLine(profile?.residentsCount ?? null, connected.length + people.length)],
      // Residents connected in the bot, as MAX knows them: nothing to type.
      [bold('Жители в боте'), ...connected.map(({ user }) => `• ${connectedLabel(user)}${user.id === userId ? ' (вы)' : ''}`)],
      me?.sharedPhone ? [] : ['Нажмите «Поделиться номером» — номер возьмём из MAX. Его увидят только жители квартиры и УК.'],
      [bold('Автомобили'), ...(vehicles.length ? vehicles.map((vehicle) => `• ${vehicle.licensePlate}${vehicle.owner ? ` — ${vehicle.owner.fullName}` : ''}`) : ['не указаны']),
        vehicles.length ? `Телефон при поиске авто: ${profile?.phoneVisibility === 'vehicle_lookup' ? 'показывается' : 'скрыт'}` : null],
    ), [
      [me?.sharedPhone ? { text: 'Убрать мой номер', payload: 'contact:remove' } : { text: 'Поделиться номером', payload: 'contact:share', requestContact: true }],
      [{ text: 'Автомобили', payload: 'hh:cars' }],
      [{ text: 'Сменить адрес или отвязаться', payload: 'apartment:change' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  private async showMyIncidents(maxUserId: string, userId: string, archive: boolean, requestedPage = 1) {
    const membership = await this.getMembership(userId);
    // Active requests are those of the current address. After moving, requests
    // of the previous address are shown in the archive only.
    const closed = { OR: [{ archivedAt: { not: null } }, { status: { in: ['resolved' as const, 'rejected' as const] } }] };
    const where = {
      authorUserId: userId,
      ...(archive
        ? { OR: [{ incident: closed }, { apartmentId: null }, ...(membership ? [{ apartmentId: { not: membership.apartmentId } }] : [{}])] }
        : membership
          ? { apartmentId: membership.apartmentId, incident: { archivedAt: null, status: { notIn: ['resolved' as const, 'rejected' as const] } } }
          : { id: { in: [] } }),
    };
    const total = await prisma.report.count({ where });
    const { page, pages, skip } = pageOf(requestedPage, total, incidentsPerPage);
    const reports = await prisma.report.findMany({
      where,
      orderBy: [{ incident: { updatedAt: 'desc' } }, { id: 'asc' }],
      skip,
      take: incidentsPerPage,
      include: { incident: { include: { building: { select: { address: true } } } } },
    });
    const listPayload = archive ? 'incidents:archive' : 'incidents:list';
    const switchButton: CallbackButton[] = [{ text: archive ? 'Активные заявки' : 'Архив заявок', payload: archive ? 'incidents:list' : 'incidents:archive' }];
    if (reports.length === 0) {
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold(archive ? 'Архив моих заявок' : 'Мои заявки')],
        [archive ? 'В архиве пока пусто. Сюда попадают завершённые заявки и заявки прежних адресов.' : 'Активных заявок нет. Если что-то случилось, нажмите «Сообщить о проблеме».'],
      ), [
        ...(archive ? [] : [[{ text: 'Сообщить о проблеме', payload: 'incident:create', intent: 'positive' as const }]]),
        switchButton,
        [{ text: 'В главное меню', payload: 'menu:main' }],
      ]);
      return;
    }
    // Titles go into the message, buttons carry only the number: long titles
    // do not fit into a button and get cut off.
    const buttons: CallbackButton[][] = [
      ...inRows(reports.map(({ incident }) => ({ text: `№ ${incident.number}`, payload: `incident:view:${incident.id}` })), 3),
      ...pageButtons(page, pages, listPayload),
      switchButton,
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ];
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold(archive ? 'Архив моих заявок' : 'Мои заявки'), archive ? 'Завершённые заявки и заявки прежних адресов' : membership ? `${membership.apartment.building.address}, кв. ${membership.apartment.number}` : null, pageLine(page, pages, total)],
      ...reports.map(({ incident }) => [
        html`${bold(`№ ${incident.number}`)} — ${incident.title}`,
        `${statusLabels[incident.status]}${archive ? `, ${incident.building.address}` : ''}`,
      ]),
      ['Нажмите номер заявки, чтобы открыть её.'],
    ), buttons);
  }

  private async showGeneralIncidents(maxUserId: string, userId: string, requestedPage = 1) {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return; }
    const where = { buildingId: membership.apartment.buildingId, archivedAt: null, locationZone: { not: 'apartment' } };
    const total = await prisma.incident.count({ where });
    const { page, pages, skip } = pageOf(requestedPage, total, incidentsPerPage);
    const incidents = await prisma.incident.findMany({
      where,
      // The id keeps the order stable between pages when supports are equal.
      orderBy: [{ reports: { _count: 'desc' } }, { updatedAt: 'desc' }, { id: 'asc' }],
      skip,
      take: incidentsPerPage,
      include: { _count: { select: { reports: true } } },
    });
    if (!incidents.length) {
      await this.messenger.sendMessageToUser(maxUserId, blocks(
        [bold('Заявки дома'), membership.apartment.building.address],
        ['Сейчас общих проблем в доме нет. Если заметили неисправность в подъезде, лифте или во дворе, сообщите о ней.'],
      ), [[{ text: 'Сообщить о проблеме', payload: 'incident:create', intent: 'positive' }], ...mainMenuLinkButtons()]);
      return;
    }
    const buttons: CallbackButton[][] = [
      ...inRows(incidents.map((incident) => ({ text: `№ ${incident.number}`, payload: `incident:view:${incident.id}` })), 3),
      ...pageButtons(page, pages, 'incidents:general'),
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ];
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Заявки дома'), membership.apartment.building.address, pageLine(page, pages, total)],
      ['Общие проблемы, которые видят все жители. Выше — те, что поддержало больше соседей.'],
      ...incidents.map((incident) => [
        html`${bold(`№ ${incident.number}`)} — ${incident.title}`,
        `${statusLabels[incident.status]}, ${incident._count.reports} ${plural(incident._count.reports, 'житель', 'жителя', 'жителей')}`,
      ]),
      ['Нажмите номер заявки, чтобы открыть её, присоединиться или обсудить.'],
    ), buttons);
  }

  // Reminders of the legal terms for a company employee: shown, or switched
  // on or off for this employee only.
  private async showLegalReminders(maxUserId: string, enable?: boolean) {
    const admin = await prisma.admin.findUnique({ where: { maxUserId }, select: { id: true, companyId: true, role: true, legalReminders: true } });
    if (!admin?.companyId || admin.role === 'platform_admin') {
      await this.messenger.sendMessageToUser(maxUserId, 'Напоминания о сроках получают сотрудники УК.', mainMenuLinkButtons());
      return;
    }
    const enabled = enable ?? admin.legalReminders;
    if (enable !== undefined && enable !== admin.legalReminders) await prisma.admin.update({ where: { id: admin.id }, data: { legalReminders: enable } });
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold(enabled ? 'Напоминания о сроках включены' : 'Напоминания о сроках отключены')],
      [enabled
        ? 'Бот напишет, когда срок по закону по заявке скоро истечёт и когда он истёк.'
        : 'Бот больше не пишет о сроках по заявкам. Сроки по-прежнему видны в пульте и в веб-диспетчерской.'],
      ['Настройка действует только для вас — коллеги получают напоминания по своим настройкам.'],
    ), [
      [enabled
        ? { text: 'Отключить напоминания', payload: 'staff:reminders:off', intent: 'negative' }
        : { text: 'Включить напоминания', payload: 'staff:reminders:on', intent: 'positive' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  private async showBotInfo(maxUserId: string) {
    const item = (title: string, text: string) => html`${bold(title)} — ${text}`;
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Возможности бота')],
      [item('Сообщить о проблеме', 'заявка для управляющей компании. Если о той же проблеме уже сообщили соседи, можно присоединиться к их заявке.')],
      [item('Мои заявки', 'ваши заявки по текущему адресу: статус, срок и ответ УК. Завершённые — в архиве.')],
      [item('Заявки дома', 'общие проблемы дома. Можно поддержать заявку и обсудить её с соседями.')],
      [item('Моя квартира', 'кто из жителей в боте, ваш номер из MAX, другие жильцы и автомобили. Здесь же смена адреса при переезде.')],
      [item('Соседи', 'поиск владельца автомобиля по номеру и сообщение другой квартире вашего дома.')],
      [item('Объявления УК', 'сообщения управляющей компании, включая прошлые.')],
      [item('Контакты УК', 'телефон, адрес и часы работы управляющей компании.')],
      [item('Экстренные службы', 'аварийные телефоны. При угрозе жизни звоните 112.')],
      [item('Приложение', 'то же самое в удобном виде: карта домов, заявки, объявления. Там же справка «Как пользоваться».')],
    ), [[{ text: 'Открыть приложение', payload: 'help', openApp: true }], [{ text: 'В главное меню', payload: 'menu:main' }]]);
  }

  private async showNeighborsMenu(maxUserId: string, userId: string) {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return; }
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Соседи')],
      [html`${bold('Узнать чьё авто')} — найти владельца машины по госномеру, если он разрешил показывать телефон.`],
      [html`${bold('Сообщение квартире')} — написать жителям другой квартиры вашего дома. Они смогут ответить.`],
    ), [
      [{ text: 'Узнать чьё авто', payload: 'car:search' }],
      [{ text: 'Сообщение квартире', payload: 'resident:message' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  // Contacts of the company that manages the resident's house. Without an
  // address the company is unknown, so the map of the mini-app is offered.
  private async showUkContacts(maxUserId: string) {
    const user = await prisma.user.findUnique({ where: { maxUserId }, select: { id: true } });
    const membership = user ? await this.getMembership(user.id) : null;
    if (!membership) {
      await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Контакты УК')], ['Управляющая компания зависит от дома. Выберите свой дом — или найдите его на карте в приложении: там видно, какая УК его обслуживает.']), [
        [{ text: 'Найти дом на карте', payload: 'map', openApp: true }],
        [{ text: 'Выбрать дом', payload: 'apartment:change' }],
        [{ text: 'Номера экстренных служб', payload: 'emergency:services' }],
      ]);
      return;
    }
    const contact = await prisma.managementCompany.findUnique({ where: { id: membership.apartment.building.companyId } });
    const text = contact
      ? blocks(
        [bold(contact.name)],
        [
          `Телефон: ${contact.phone}`,
          contact.email ? `Email: ${contact.email}` : null,
          contact.address ? `Офис: ${contact.address}` : null,
          contact.workingHours ? `Часы работы: ${contact.workingHours}` : null,
        ],
        contact.cleaningInfo ? [bold('Уборка и благоустройство'), contact.cleaningInfo] : [],
        contact.note ? [contact.note] : [],
      )
      : blocks([bold('Контакты УК')], ['Управляющая компания пока не добавила контакты. О проблеме можно сообщить через «Сообщить о проблеме», а при аварии — позвонить в экстренные службы.']);
    await this.messenger.sendMessageToUser(maxUserId, text, [
      [{ text: 'Обязанности УК и сроки', payload: 'uk:duties' }],
      [{ text: 'Номера экстренных служб', payload: 'emergency:services' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  private async askConsent(maxUserId: string, buildingId: string) {
    const policy = privacyUrl();
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Согласие на обработку персональных данных')],
      ['Чтобы подключить вас к дому, бот сохранит ваш адрес и номер квартиры, имя из профиля MAX, а также заявки, комментарии и фото, которые вы отправите. Номер телефона и автомобиль — только если вы сами их укажете.'],
      ['Данные видит только ваша управляющая компания и, в объёме, который вы разрешите, соседи. Согласие можно отозвать: «Моя квартира» → «Отвязаться от квартиры».'],
    ), [
      [{ text: 'Согласен, продолжить', payload: `consent:accept:${buildingId}`, intent: 'positive' }],
      ...(policy ? [[{ text: 'Политика обработки данных', payload: 'privacy:open', url: policy }]] : []),
      [{ text: 'Отмена', payload: 'menu:main', intent: 'negative' }],
    ]);
  }

  // Polls of the company: open ones first, a tap opens one.
  private async showPolls(maxUserId: string, userId: string) {
    const items = await pollsFor(userId);
    const open = items.filter((poll) => poll.active);
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Опросы УК')],
      [items.length ? `Идут: ${open.length}. Голос — один от квартиры.` : 'Опросов пока нет. Когда УК начнёт опрос, бот пришлёт сообщение.'],
    ), [
      ...items.slice(0, 10).map((poll) => [{ text: `${poll.active ? (poll.myOptionId ? '✓ ' : '• ') : '◦ '}${poll.question.length > 55 ? `${poll.question.slice(0, 54)}…` : poll.question}`, payload: `poll:open:${poll.id}` }]),
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  private async showPoll(maxUserId: string, userId: string, pollId: string, notice?: string) {
    const poll = await pollFor(userId, pollId);
    if (!poll) { await this.messenger.sendMessageToUser(maxUserId, 'Опрос недоступен.', [[{ text: 'Все опросы', payload: 'polls:list' }], [{ text: 'В главное меню', payload: 'menu:main' }]]); return; }
    const total = poll.options.reduce((sum, option) => sum + (option.count ?? 0), 0);
    const until = localTime(new Date(poll.closedAt ?? poll.endsAt), poll.timeZone);
    const lines = poll.showResults
      ? poll.options.map((option) => {
        const share = total ? Math.round(((option.count ?? 0) / total) * 100) : 0;
        return `${option.id === poll.myOptionId ? '✓ ' : ''}${option.text} — ${option.count ?? 0} (${share}%)${option.apartments?.length ? `\n   ${option.apartments.join(', ')}` : ''}`;
      })
      : ['Результаты откроются после вашего голоса.'];
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold(poll.question), `${poll.scope}`, poll.active ? `Голосование до ${until}` : `Завершён: ${until}`],
      [poll.anonymous ? 'Анонимный: соседи видят только числа.' : 'Открытый: видно, какие квартиры за что.', poll.allowChange ? 'Голос можно изменить до окончания.' : 'Голос окончательный.'],
      lines,
      notice ? [notice] : [],
    ), poll.canVote
      ? pollButtons(poll.id, poll.options.map((option) => ({ id: option.id, text: option.text, mine: option.id === poll.myOptionId })))
      : [[{ text: 'Открыть в приложении', payload: `poll_${poll.id}`, openApp: true }], [{ text: 'Все опросы', payload: 'polls:list' }, { text: 'В главное меню', payload: 'menu:main' }]]);
  }

  // What the company owes by law, with the longest terms.
  private async showDuties(maxUserId: string) {
    const user = await prisma.user.findUnique({ where: { maxUserId }, select: { id: true } });
    const membership = user ? await this.getMembership(user.id) : null;
    const { items } = await dutiesFor(membership?.apartment.building.companyId ?? null);
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Обязанности УК и сроки')],
      ...items.map((block) => [bold(block.title), ...block.items.map((item) => `— ${item}`), block.source ? `Основание: ${block.source}` : null]),
      ['Договор управления может устанавливать более короткие сроки. При нарушениях — жилищная инспекция региона.'],
    ), [[{ text: 'Контакты УК', payload: 'uk:contacts' }], [{ text: 'В главное меню', payload: 'menu:main' }]]);
  }

  private async showAnnouncements(maxUserId: string, userId: string, page: number) {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return; }
    const items = await prisma.announcement.findMany({
      where: announcementFilter(membership),
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * announcementsPageSize,
      take: announcementsPageSize + 1,
      select: { id: true, text: true, createdAt: true },
    });
    if (!items.length) {
      await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Объявления УК')], [page === 1 ? 'Объявлений пока нет. Когда управляющая компания что-то сообщит, сообщение придёт сюда и сохранится в этом разделе.' : 'Более ранних объявлений нет.']), [
        ...(page > 1 ? [[{ text: 'К последним объявлениям', payload: 'announcements:list' }]] : []),
        [{ text: 'В главное меню', payload: 'menu:main' }],
      ]);
      return;
    }
    const hasMore = items.length > announcementsPageSize;
    const visible = items.slice(0, announcementsPageSize);
    const firstNumber = (page - 1) * announcementsPageSize + 1;
    const buttons: CallbackButton[][] = inRows(visible.map((item, index) => ({ text: `№ ${firstNumber + index}`, payload: `announcements:view:${item.id}` })), 3);
    const navigation: CallbackButton[] = [
      ...(page > 1 ? [{ text: 'Новее', payload: `announcements:page:${page - 1}` }] : []),
      ...(hasMore ? [{ text: 'Более ранние', payload: `announcements:page:${page + 1}` }] : []),
    ];
    if (navigation.length) buttons.push(navigation);
    buttons.push([{ text: 'В главное меню', payload: 'menu:main' }]);
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold(page === 1 ? 'Объявления УК' : `Объявления УК, страница ${page}`)],
      ...visible.map((item, index) => [html`${bold(`№ ${firstNumber + index}.`)} ${preview(item.text, 120)}`]),
      ['Нажмите номер, чтобы открыть объявление: там дата и полный текст.'],
    ), buttons);
  }

  private async showAnnouncement(maxUserId: string, userId: string, announcementId: string) {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return; }
    const item = await prisma.announcement.findFirst({ where: { id: announcementId, ...announcementFilter(membership) }, select: { text: true, createdAt: true, audience: true } });
    if (!item) {
      await this.messenger.sendMessageToUser(maxUserId, 'Объявление удалено или недоступно.', [[{ text: 'Объявления УК', payload: 'announcements:list' }]]);
      return;
    }
    const audience = item.audience === 'apartment' ? 'Для вашей квартиры' : item.audience === 'building' ? 'Для вашего дома' : item.audience === 'street' ? 'Для вашей улицы' : 'Для всех жителей';
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Объявление УК')],
      [`Отправлено: ${formatInZone(item.createdAt, buildingZone(membership.apartment.building))}`, `Кому: ${audience.toLowerCase()}`],
      [item.text],
    ), [
      [{ text: 'Все объявления', payload: 'announcements:list' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  // Apartment data belongs to whoever lives there. It may be cleared by the last
  // resident who moved out, or by a new resident who is alone in the apartment.
  private async clearPreviousApartment(maxUserId: string, userId: string, apartmentId: string) {
    if (!await canClearApartmentData(userId, apartmentId)) {
      await this.messenger.sendMessageToUser(maxUserId, 'Эти данные сейчас нельзя очистить: в квартире есть другие привязанные жители или данных уже нет.', mainMenuLinkButtons());
      return;
    }
    await prisma.$transaction((tx) => clearApartmentData(tx, apartmentId));
    await this.messenger.sendMessageToUser(maxUserId, 'Данные квартиры очищены: число жильцов, телефоны, ФИО и автомобили удалены.', [
      [{ text: 'Моя квартира', payload: 'profile:view' }],
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ]);
  }

  private async hasCurrentAddressReport(userId: string, incidentId: string) {
    const membership = await this.getMembership(userId);
    if (!membership) return false;
    const report = await prisma.report.findUnique({ where: { incidentId_authorUserId: { incidentId, authorUserId: userId } }, select: { apartmentId: true } });
    return report?.apartmentId === membership.apartmentId;
  }

  private async showEmergencyServices(maxUserId: string) {
    // City-wide numbers plus those added by the company of the resident's house.
    const user = await prisma.user.findUnique({ where: { maxUserId }, select: { id: true } });
    const membership = user ? await this.getMembership(user.id) : null;
    const companyId = membership?.apartment.building.companyId ?? null;
    const [services, company] = await Promise.all([
      prisma.emergencyService.findMany({ where: { OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] }, orderBy: { createdAt: 'asc' } }),
      companyId ? prisma.managementCompany.findUnique({ where: { id: companyId }, select: { quickDial: true } }) : null,
    ]);
    const quick = [bold('Быстрый набор'), ...quickDialOf(company?.quickDial).map((item) => `${item.number} — ${item.title}`)];
    const text = services.length
      ? blocks([bold('Номера экстренных служб'), 'При угрозе жизни или здоровью звоните 112.'], quick, ...services.map((service) => [bold(service.name), service.phone, service.description]))
      : blocks([bold('Номера экстренных служб')], quick, ['УК пока не добавила телефоны служб. При угрозе жизни или здоровью звоните 112.']);
    await this.messenger.sendMessageToUser(maxUserId, text, [[{ text: 'В главное меню', payload: 'menu:main' }]]);
  }

  private async showOwnComments(maxUserId: string, userId: string, incidentId: string) {
    const comments = await prisma.incidentComment.findMany({ where: { incidentId, authorUserId: userId }, orderBy: { createdAt: 'asc' }, select: { id: true, text: true, createdAt: true, incident: { select: { building: { select: { city: true, longitude: true } } } } } });
    const back: CallbackButton[] = [{ text: 'Назад к заявке', payload: `incident:view:${incidentId}` }];
    if (!comments.length) {
      await this.messenger.sendMessageToUser(maxUserId, 'У вас нет комментариев к этой заявке.', [back]);
      return;
    }
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Мои комментарии')],
      ...comments.map((comment, index) => [html`${bold(`${index + 1}.`)} ${preview(comment.text, 200)}`, formatInZone(comment.createdAt, buildingZone(comment.incident.building))]),
      ['Нажмите «Удалить» с номером комментария.'],
    ), [...inRows(comments.map((comment, index) => ({ text: `Удалить ${index + 1}`, payload: `comment:delete:${comment.id}`, intent: 'negative' as const })), 3), back]);
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
        building: { select: { address: true, city: true, longitude: true } },
        _count: { select: { reports: true, comments: true } },
        reports: { where: { authorUserId: userId }, select: { id: true, apartmentId: true } },
        comments: { orderBy: { createdAt: 'desc' }, take: incidentCommentsShown, select: { text: true, createdAt: true, apartment: { select: { number: true } } } },
        photos: { orderBy: { createdAt: 'asc' }, select: { id: true, token: true, url: true } },
        events: { where: { type: 'incident_updated' }, orderBy: { createdAt: 'desc' }, take: 20, select: { payload: true, createdAt: true } },
      },
    });
    if (!incident) {
      await this.messenger.sendMessageToUser(maxUserId, 'Заявка не найдена или больше вам недоступна.', mainMenuLinkButtons());
      return;
    }
    const isCurrentPublicIncident = Boolean(
      membership
      && incident.locationZone !== 'apartment'
      && incident.buildingId === membership.apartment.buildingId,
    );
    // Requests of a previous address can be viewed but no longer changed.
    const hasOwnReport = Boolean(membership) && incident.reports.some((report) => report.apartmentId === membership?.apartmentId);
    const hasAnyOwnReport = incident.reports.length > 0;
    const isActive = !['resolved', 'rejected'].includes(incident.status);
    const place = incident.locationZone === 'apartment'
      ? `квартира ${incident.apartmentNumber ?? ''}`.trim()
      : incident.locationZone === 'entrance' && incident.entranceNumber
        ? `подъезд ${incident.entranceNumber}`
        : `${(zoneLabels[incident.locationZone] ?? incident.locationZone).toLowerCase()}${incident.entranceNumber ? `, подъезд ${incident.entranceNumber}` : ''}`;
    const reply = incident.events
      .map((event) => ({ text: (event.payload as { publicComment?: unknown }).publicComment, at: event.createdAt }))
      .find((event): event is { text: string; at: Date } => typeof event.text === 'string' && event.text.length > 0);
    const comments = [...incident.comments].reverse();
    const feedback = hasAnyOwnReport ? await feedbackState(userId, incident, true) : null;
    const feedbackLines = feedback?.answer
      ? [bold('Ваш ответ'), feedback.answer.resolved
        ? `Проблема решена${feedback.answer.rating ? `, оценка ${feedback.answer.rating} из 5` : ''}`
        : 'Не решено — заявка возвращена в работу']
      : feedback?.canAnswer && feedback.until
        ? [bold('Проблема действительно решена?'), `Если нет — нажмите «Не решено», заявка вернётся в работу. Без ответа до ${formatInZone(feedback.until, buildingZone(incident.building))} работа будет считаться принятой.`]
        : [];
    const residents = `${incident._count.reports} ${plural(incident._count.reports, 'житель', 'жителя', 'жителей')}`;
    const zone = buildingZone(incident.building);

    const text = blocks(
      [bold(`Заявка № ${incident.number}`), incident.title],
      [
        html`Статус: ${bold(statusLabels[incident.status])}`,
        incident.dueAt && isActive ? `Плановый срок: ${formatInZone(incident.dueAt, zone)}` : null,
        isActive ? `Срок по закону: ${legalTermLine(legalTermOf({ ...incident, timeZone: zone }))}` : null,
        incident.delayReason ? `Причина переноса: ${incident.delayReason}` : null,
        incident.rejectionReason ? `Причина отклонения: ${incident.rejectionReason}` : null,
      ],
      [
        `Адрес: ${incident.building.address}, ${place}`,
        `Категория: ${categoryLabels[incident.category]}`,
        `Обратились: ${residents}${hasAnyOwnReport ? ', в том числе вы' : ''}`,
      ],
      reply ? [bold('Ответ УК'), reply.text, formatInZone(reply.at, zone)] : [],
      comments.length
        ? [
          bold(incident._count.comments > comments.length ? `Обсуждение, последние ${comments.length} из ${incident._count.comments}` : 'Обсуждение'),
          ...comments.map((comment) => html`${bold(`кв. ${comment.apartment?.number ?? '—'}`)}: ${comment.text}`),
        ]
        : [],
      isCurrentPublicIncident && isActive && !hasAnyOwnReport
        ? ['Если проблема касается и вас, присоединитесь: заявка поднимется выше, а вы будете получать уведомления.']
        : [],
      feedbackLines,
    );
    const ownComments = await prisma.incidentComment.count({ where: { incidentId: incident.id, authorUserId: userId } });
    const feedbackRows: CallbackButton[][] = !feedback?.canAnswer ? []
      : !feedback.answer ? feedbackButtons(incident.id)
        : feedback.answer.resolved ? [[{ text: 'Изменить оценку', payload: `incident:accept:${incident.id}` }, { text: 'Всё-таки не решено', payload: `incident:reopen:${incident.id}`, intent: 'negative' }]]
          : [];
    const buttons: CallbackButton[][] = [
      ...feedbackRows,
      ...(isCurrentPublicIncident && isActive && !hasAnyOwnReport ? [[{ text: 'Присоединиться к заявке', payload: `incident:join-public:${incident.id}`, intent: 'positive' as const }]] : []),
      ...(isActive && (isCurrentPublicIncident || hasOwnReport) ? [[
        ...(isCurrentPublicIncident ? [{ text: 'Комментировать', payload: `incident:comment:${incident.id}` }] : []),
        ...(hasOwnReport ? [{ text: 'Добавить фото', payload: `incident:photo:add:${incident.id}` }] : []),
      ]] : []),
      ...(ownComments ? [[{ text: ownComments === 1 ? 'Мой комментарий' : `Мои комментарии (${ownComments})`, payload: `comments:mine:${incident.id}` }]] : []),
      [{ text: 'Мои заявки', payload: 'incidents:list' }, { text: 'Заявки дома', payload: 'incidents:general' }],
      ...(isActive && hasOwnReport ? [[{ text: 'Отменить моё обращение', payload: `incident:cancel:${incident.id}`, intent: 'negative' as const }]] : []),
      [{ text: 'В главное меню', payload: 'menu:main' }],
    ];
    await this.messenger.sendMessageToUser(maxUserId, text, buttons, toMessengerImages(incident.photos));
  }

  // ---------- Residents, phones and cars of the apartment ----------
  // Every record has its own screen with "change" and "delete", instead of
  // retyping the whole list. Payloads start with "hh:".

  private async handleHousehold(maxUserId: string, userId: string, payload: string): Promise<boolean> {
    const membership = await this.getMembershipWithUser(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return true; }
    const apartmentId = membership.apartmentId;
    const [action, id] = payload.slice('hh:'.length).split(':');
    if (id !== undefined && !/^\d+$/.test(id) && !z.string().uuid().safeParse(id).success) return false;

    switch (action) {
      case 'people': await this.showPeople(maxUserId, userId, apartmentId); return true;
      case 'cars': await this.showCars(maxUserId, userId, apartmentId); return true;
      case 'phones': await this.showCars(maxUserId, userId, apartmentId); return true;
      case 'person': await this.showPerson(maxUserId, userId, apartmentId, id!); return true;
      case 'car': await this.showCar(maxUserId, userId, apartmentId, id!); return true;
      case 'person-add': {
        if (await this.countPeople(apartmentId) >= peopleLimit) { await this.showPeople(maxUserId, userId, apartmentId, `Можно указать не больше ${peopleLimit} жильцов. Удалите кого-нибудь, чтобы добавить нового.`); return true; }
        await this.saveSession(userId, 'household_person_add', {});
        await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Новый жилец')], ['Напишите ФИО. Через пробел можно сразу указать телефон.'], ['Например: Иванов Иван Иванович 8 900 123-45-67']), [[{ text: 'Отмена', payload: 'hh:people' }]]);
        return true;
      }
      case 'person-name': case 'person-phones': {
        const person = await this.findPerson(apartmentId, id!);
        if (!person) { await this.showPeople(maxUserId, userId, apartmentId, 'Этого жильца уже нет в данных квартиры.'); return true; }
        const isName = action === 'person-name';
        await this.saveSession(userId, isName ? 'household_person_name' : 'household_person_phones', { personId: person.id });
        await this.messenger.sendMessageToUser(maxUserId, blocks(
          [bold(person.fullName)],
          [isName ? 'Напишите новое ФИО.' : 'Напишите телефоны через запятую. Чтобы удалить все телефоны жильца, отправьте «нет».'],
          isName ? [] : [`Сейчас: ${person.phones.length ? person.phones.join(', ') : 'не указаны'}`],
        ), [[{ text: 'Отмена', payload: `hh:person:${person.id}` }]]);
        return true;
      }
      case 'person-delete': {
        const person = await this.findPerson(apartmentId, id!);
        if (!person) { await this.showPeople(maxUserId, userId, apartmentId); return true; }
        await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Удалить жильца?')], [`${person.fullName} пропадёт из данных квартиры. Это не отключает никого от бота.`]), [
          [{ text: 'Да, удалить', payload: `hh:person-delete-yes:${person.id}`, intent: 'negative' }],
          [{ text: 'Отмена', payload: `hh:person:${person.id}` }],
        ]);
        return true;
      }
      case 'person-delete-yes': {
        const removed = await prisma.residentPerson.deleteMany({ where: { id: id!, isVehicleOwner: false, profile: { apartmentId } } });
        // The total number of residents shrinks together with the list, so
        // "Проживает: 3" does not stay after two people were removed.
        if (removed.count) {
          const profile = await prisma.residentProfile.findUnique({ where: { apartmentId }, select: { residentsCount: true } });
          if (profile?.residentsCount !== null && profile?.residentsCount !== undefined) {
            const listed = await this.countKnownResidents(apartmentId);
            await prisma.residentProfile.update({ where: { apartmentId }, data: { residentsCount: Math.max(listed, profile.residentsCount - 1) || null } });
          }
        }
        await this.showPeople(maxUserId, userId, apartmentId, removed.count ? 'Жилец удалён.' : undefined);
        return true;
      }
      case 'car-add': {
        if (await prisma.vehicle.count({ where: { apartmentId } }) >= carsLimit) { await this.showCars(maxUserId, userId, apartmentId, `Можно указать не больше ${carsLimit} автомобилей. Удалите один, чтобы добавить новый.`); return true; }
        await this.saveSession(userId, 'household_car_add', {});
        await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Новый автомобиль')], ['Напишите госномер. Если машина ваша — больше ничего не нужно: владельцем станете вы, имя и номер возьмём из MAX.'], ['Если владелец другой, допишите его имя и телефон: А123ВС72 Иван 8 900 123-45-67']), [[{ text: 'Отмена', payload: 'hh:cars' }]]);
        return true;
      }
      case 'car-owner': {
        const car = await this.findCar(apartmentId, id!);
        if (!car) { await this.showCars(maxUserId, userId, apartmentId, 'Этого автомобиля уже нет в данных квартиры.'); return true; }
        await this.saveSession(userId, 'household_car_owner', { vehicleId: car.id });
        await this.messenger.sendMessageToUser(maxUserId, blocks([bold(car.licensePlate)], ['Напишите имя владельца и телефон.'], ['Например: Иван 8 900 123-45-67']), [[{ text: 'Отмена', payload: `hh:car:${car.id}` }]]);
        return true;
      }
      case 'car-owner-me': {
        const car = await this.findCar(apartmentId, id!);
        if (!car) { await this.showCars(maxUserId, userId, apartmentId, 'Этого автомобиля уже нет в данных квартиры.'); return true; }
        await prisma.$transaction((tx) => this.setCarOwner(tx, apartmentId, car, ...this.ownerFromMax(membership.user)));
        await this.showCar(maxUserId, userId, apartmentId, car.id, membership.user.sharedPhone ? 'Владелец — вы, номер взят из MAX.' : 'Владелец — вы. Поделитесь номером в «Моя квартира», чтобы сосед мог позвонить.');
        return true;
      }
      case 'car-delete': {
        const car = await this.findCar(apartmentId, id!);
        if (!car) { await this.showCars(maxUserId, userId, apartmentId); return true; }
        await this.messenger.sendMessageToUser(maxUserId, blocks([bold('Удалить автомобиль?')], [`${car.licensePlate} пропадёт из данных квартиры и из поиска «Узнать чьё авто».`]), [
          [{ text: 'Да, удалить', payload: `hh:car-delete-yes:${car.id}`, intent: 'negative' }],
          [{ text: 'Отмена', payload: `hh:car:${car.id}` }],
        ]);
        return true;
      }
      case 'car-delete-yes': {
        const car = await this.findCar(apartmentId, id!);
        if (car) {
          await prisma.$transaction(async (tx) => {
            await tx.vehicle.delete({ where: { id: car.id } });
            if (car.ownerPersonId) await tx.residentPerson.deleteMany({ where: { id: car.ownerPersonId, isVehicleOwner: true, vehicles: { none: {} } } });
          });
        }
        await this.showCars(maxUserId, userId, apartmentId, car ? 'Автомобиль удалён.' : undefined);
        return true;
      }
      default:
        return false;
    }
  }

  private async handleHouseholdText(maxUserId: string, userId: string, step: string, data: SessionData, text: string): Promise<boolean> {
    const membership = await this.getMembership(userId);
    if (!membership) { await this.askApartmentCode(maxUserId, userId); return true; }
    const apartmentId = membership.apartmentId;
    const personId = data.personId;
    if ((step === 'household_person_name' || step === 'household_person_phones') && !personId) {
      await this.showPeople(maxUserId, userId, apartmentId);
      return true;
    }

    if (step === 'household_person_add' || step === 'household_person_name') {
      const fullName = removePhones(text).replace(/[|,;]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (fullName.length < 3 || fullName.length > 150) {
        await this.messenger.sendMessageToUser(maxUserId, 'Напишите ФИО полностью — от 3 до 150 символов.', [[{ text: 'Отмена', payload: step === 'household_person_add' ? 'hh:people' : `hh:person:${data.personId}` }]]);
        return true;
      }
      if (step === 'household_person_add') {
        if (await this.countPeople(apartmentId) >= peopleLimit) { await this.showPeople(maxUserId, userId, apartmentId, `Можно указать не больше ${peopleLimit} жильцов.`); return true; }
        const profile = await prisma.residentProfile.upsert({ where: { apartmentId }, update: {}, create: { apartmentId } });
        const person = await prisma.residentPerson.create({ data: { profileId: profile.id, fullName, phones: extractPhones(text).slice(0, phonesLimit) } });
        await this.showPerson(maxUserId, userId, apartmentId, person.id, 'Жилец добавлен.');
        return true;
      }
      const updated = await prisma.residentPerson.updateMany({ where: { id: personId!, isVehicleOwner: false, profile: { apartmentId } }, data: { fullName } });
      if (!updated.count) { await this.showPeople(maxUserId, userId, apartmentId, 'Этого жильца уже нет в данных квартиры.'); return true; }
      await this.showPerson(maxUserId, userId, apartmentId, data.personId!, 'ФИО изменено.');
      return true;
    }

    if (step === 'household_person_phones') {
      const clear = /^(нет|-|удалить)$/i.test(text.trim());
      const phones = clear ? [] : extractPhones(text).slice(0, phonesLimit);
      if (!clear && !phones.length) {
        await this.messenger.sendMessageToUser(maxUserId, 'Не нашёл телефон. Напишите номер из 10 цифр после +7 или 8, например 8 900 123-45-67, или «нет», чтобы удалить телефоны.', [[{ text: 'Отмена', payload: `hh:person:${data.personId}` }]]);
        return true;
      }
      const updated = await prisma.residentPerson.updateMany({ where: { id: personId!, isVehicleOwner: false, profile: { apartmentId } }, data: { phones } });
      if (!updated.count) { await this.showPeople(maxUserId, userId, apartmentId, 'Этого жильца уже нет в данных квартиры.'); return true; }
      await this.showPerson(maxUserId, userId, apartmentId, data.personId!, clear ? 'Телефоны удалены.' : 'Телефоны сохранены.');
      return true;
    }

    if (step === 'household_car_add') {
      const { licensePlate, rest: details } = splitPlate(text);
      if (licensePlate.length < 5 || licensePlate.length > 12) {
        await this.messenger.sendMessageToUser(maxUserId, 'Начните с госномера, например А123ВС72, затем через пробел имя владельца и телефон.', [[{ text: 'Отмена', payload: 'hh:cars' }]]);
        return true;
      }
      const existing = await prisma.vehicle.findUnique({ where: { licensePlate }, select: { apartmentId: true } });
      if (existing) {
        await this.messenger.sendMessageToUser(maxUserId, existing.apartmentId === apartmentId ? `${licensePlate} уже есть в вашей квартире.` : `${licensePlate} уже указан у другой квартиры. Если это ваша машина, обратитесь в управляющую компанию.`, [[{ text: 'К автомобилям', payload: 'hh:cars' }]]);
        return true;
      }
      if (await prisma.vehicle.count({ where: { apartmentId } }) >= carsLimit) { await this.showCars(maxUserId, userId, apartmentId, `Можно указать не больше ${carsLimit} автомобилей.`); return true; }
      const typedName = removePhones(details).replace(/[|,;]+/g, ' ').replace(/\s+/g, ' ').trim();
      const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true, sharedPhone: true } });
      const [ownerName, ownerPhones] = typedName ? [typedName, extractPhones(details).slice(0, phonesLimit)] : this.ownerFromMax(me);
      const car = await prisma.$transaction(async (tx) => {
        const profile = await tx.residentProfile.upsert({ where: { apartmentId }, update: {}, create: { apartmentId } });
        const owner = await tx.residentPerson.create({ data: { profileId: profile.id, fullName: ownerName, phones: ownerPhones, isVehicleOwner: true } });
        return tx.vehicle.create({ data: { userId, apartmentId, licensePlate, ownerPersonId: owner.id } });
      });
      await this.showCar(maxUserId, userId, apartmentId, car.id, typedName ? 'Автомобиль добавлен.' : 'Автомобиль добавлен, владелец — вы.');
      return true;
    }

    if (step === 'household_car_owner') {
      const car = data.vehicleId ? await this.findCar(apartmentId, data.vehicleId) : null;
      if (!car) { await this.showCars(maxUserId, userId, apartmentId, 'Этого автомобиля уже нет в данных квартиры.'); return true; }
      const ownerName = removePhones(text).replace(/[|,;]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (ownerName.length < 2 || ownerName.length > 150) {
        await this.messenger.sendMessageToUser(maxUserId, 'Напишите имя владельца, а через пробел — телефон.', [[{ text: 'Отмена', payload: `hh:car:${car.id}` }]]);
        return true;
      }
      const phones = extractPhones(text).slice(0, phonesLimit);
      await prisma.$transaction(async (tx) => {
        if (car.ownerPersonId) {
          await tx.residentPerson.update({ where: { id: car.ownerPersonId }, data: { fullName: ownerName, phones } });
        } else {
          const profile = await tx.residentProfile.upsert({ where: { apartmentId }, update: {}, create: { apartmentId } });
          const owner = await tx.residentPerson.create({ data: { profileId: profile.id, fullName: ownerName, phones, isVehicleOwner: true } });
          await tx.vehicle.update({ where: { id: car.id }, data: { ownerPersonId: owner.id } });
        }
      });
      await this.showCar(maxUserId, userId, apartmentId, car.id, 'Владелец сохранён.');
      return true;
    }

    return false;
  }

  private getMembershipWithUser(userId: string) {
    return prisma.residentMembership.findFirst({ where: { userId, revokedAt: null }, orderBy: { verifiedAt: 'desc' }, include: { user: { select: { displayName: true, sharedPhone: true } } } });
  }

  // The resident as a car owner: the name and the phone shared from MAX.
  private ownerFromMax(user: { displayName: string | null; sharedPhone: string | null }): [string, string[]] {
    return [user.displayName?.trim() || 'Житель квартиры', user.sharedPhone ? [user.sharedPhone] : []];
  }

  private async setCarOwner(tx: Prisma.TransactionClient, apartmentId: string, car: { id: string; ownerPersonId: string | null }, fullName: string, phones: string[]) {
    if (car.ownerPersonId) {
      await tx.residentPerson.update({ where: { id: car.ownerPersonId }, data: { fullName, phones } });
      return;
    }
    const profile = await tx.residentProfile.upsert({ where: { apartmentId }, update: {}, create: { apartmentId } });
    const owner = await tx.residentPerson.create({ data: { profileId: profile.id, fullName, phones, isVehicleOwner: true } });
    await tx.vehicle.update({ where: { id: car.id }, data: { ownerPersonId: owner.id } });
  }

  // Everybody counted as living in the apartment: residents in the bot plus
  // the ones listed by name.
  private async countKnownResidents(apartmentId: string) {
    const [connected, listed] = await Promise.all([prisma.residentMembership.count({ where: { apartmentId, revokedAt: null } }), this.countPeople(apartmentId)]);
    return connected + listed;
  }

  private countPeople(apartmentId: string) {
    return prisma.residentPerson.count({ where: { isVehicleOwner: false, profile: { apartmentId } } });
  }

  private findPerson(apartmentId: string, personId: string) {
    return prisma.residentPerson.findFirst({ where: { id: personId, isVehicleOwner: false, profile: { apartmentId } } });
  }

  private findCar(apartmentId: string, vehicleId: string) {
    return prisma.vehicle.findFirst({ where: { id: vehicleId, apartmentId }, include: { owner: true } });
  }

  private async showPeople(maxUserId: string, userId: string, apartmentId: string, notice?: string) {
    await prisma.botSession.deleteMany({ where: { userId } });
    const [people, connected, profile] = await Promise.all([
      prisma.residentPerson.findMany({ where: { isVehicleOwner: false, profile: { apartmentId } }, orderBy: { fullName: 'asc' } }),
      prisma.residentMembership.count({ where: { apartmentId, revokedAt: null } }),
      prisma.residentProfile.findUnique({ where: { apartmentId }, select: { residentsCount: true } }),
    ]);
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      notice ? [bold(notice)] : [],
      [bold('Другие жильцы'), 'Те, кто живёт в квартире, но не подключён к боту: дети, пожилые родственники. Жителей из бота добавлять не нужно — они уже видны в «Моя квартира».'],
      people.length ? people.map((person) => `• ${person.fullName}${person.phones.length ? `, ${person.phones.map(displayPhone).join(', ')}` : ''}`) : ['Пока никто не указан.'],
      [residentsLine(profile?.residentsCount ?? null, connected + people.length)],
    ), [
      ...people.map((person) => [{ text: person.fullName.slice(0, 60), payload: `hh:person:${person.id}` }]),
      [{ text: 'Добавить жильца', payload: 'hh:person-add', intent: 'positive' as const }],
      [{ text: 'Сколько проживает всего', payload: 'profile:residents' }],
      [{ text: 'Назад к квартире', payload: 'profile:view' }],
    ]);
  }

  private async showPerson(maxUserId: string, userId: string, apartmentId: string, personId: string, notice?: string) {
    await prisma.botSession.deleteMany({ where: { userId } });
    const person = await this.findPerson(apartmentId, personId);
    if (!person) { await this.showPeople(maxUserId, userId, apartmentId, 'Этого жильца уже нет в данных квартиры.'); return; }
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      notice ? [bold(notice)] : [],
      [bold(person.fullName), `Телефоны: ${person.phones.length ? person.phones.join(', ') : 'не указаны'}`],
    ), [
      [{ text: 'Изменить ФИО', payload: `hh:person-name:${person.id}` }, { text: 'Изменить телефоны', payload: `hh:person-phones:${person.id}` }],
      [{ text: 'Удалить жильца', payload: `hh:person-delete:${person.id}`, intent: 'negative' }],
      [{ text: 'К списку жильцов', payload: 'hh:people' }],
    ]);
  }

  private async showCars(maxUserId: string, userId: string, apartmentId: string, notice?: string) {
    await prisma.botSession.deleteMany({ where: { userId } });
    const [cars, profile] = await Promise.all([
      prisma.vehicle.findMany({ where: { apartmentId }, include: { owner: true }, orderBy: { createdAt: 'asc' } }),
      prisma.residentProfile.findUnique({ where: { apartmentId }, select: { phoneVisibility: true } }),
    ]);
    const visible = profile?.phoneVisibility === 'vehicle_lookup';
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      notice ? [bold(notice)] : [],
      [bold('Автомобили квартиры')],
      cars.length ? cars.map((car) => `• ${car.licensePlate}${car.owner ? ` — ${car.owner.fullName}` : ''}`) : ['Пока ни одного.'],
      [html`Телефон при поиске авто: ${bold(visible ? 'показывается' : 'скрыт')}`, visible
        ? 'Сосед, который ищет машину по госномеру, увидит номер владельца, а если его нет — номер жителя квартиры из MAX.'
        : 'Включите показ, чтобы сосед мог позвонить, если ваша машина ему мешает.'],
    ), [
      ...cars.map((car) => [{ text: `${car.licensePlate}${car.owner ? ` — ${car.owner.fullName}` : ''}`.slice(0, 60), payload: `hh:car:${car.id}` }]),
      ...(cars.length < carsLimit ? [[{ text: 'Добавить автомобиль', payload: 'hh:car-add', intent: 'positive' as const }]] : []),
      [visible ? { text: 'Скрыть телефон при поиске', payload: 'profile:phone-consent:no' } : { text: 'Показывать телефон при поиске', payload: 'profile:visibility' }],
      [{ text: 'Назад к квартире', payload: 'profile:view' }],
    ]);
  }

  private async showCar(maxUserId: string, userId: string, apartmentId: string, vehicleId: string, notice?: string) {
    await prisma.botSession.deleteMany({ where: { userId } });
    const car = await this.findCar(apartmentId, vehicleId);
    if (!car) { await this.showCars(maxUserId, userId, apartmentId, 'Этого автомобиля уже нет в данных квартиры.'); return; }
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      notice ? [bold(notice)] : [],
      [bold(car.licensePlate), `Владелец: ${car.owner?.fullName ?? 'не указан'}`, `Телефон владельца: ${car.owner?.phones.length ? car.owner.phones.map(displayPhone).join(', ') : 'не указан'}`],
      ['Чтобы исправить госномер, удалите автомобиль и добавьте заново.'],
    ), [
      [{ text: 'Владелец — я', payload: `hh:car-owner-me:${car.id}` }, { text: 'Другой владелец', payload: `hh:car-owner:${car.id}` }],
      [{ text: 'Удалить автомобиль', payload: `hh:car-delete:${car.id}`, intent: 'negative' }],
      [{ text: 'К автомобилям', payload: 'hh:cars' }],
    ]);
  }


  // Cancel makes sense only for a resident who already has an address: a new
  // resident has nowhere to return to, so the list shows no cancel button and
  // later steps offer to pick another building instead.
  private async chosenAddress(data: SessionData) {
    if (!data.buildingId) return null;
    const building = await prisma.building.findUnique({ where: { id: data.buildingId }, select: { address: true } });
    return building ? `${building.address}${data.apartmentNumber ? `, кв. ${data.apartmentNumber}` : ''}` : null;
  }

  // A resident without an apartment learns why «Главное меню» shows the
  // choice of a house.
  private async menuLaterLine(userId: string) {
    return await this.getMembership(userId) ? [] : [menuLater];
  }

  private async addressButtons(userId: string, stage: 'list' | 'inside'): Promise<CallbackButton[][]> {
    if (await this.getMembership(userId)) return [[{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }]];
    // The house may be chosen in the app meanwhile: then this button opens
    // the menu without typing /start.
    const menu: CallbackButton[] = [{ text: 'Главное меню', payload: 'menu:main' }];
    return stage === 'inside' ? [[{ text: 'Выбрать другой дом', payload: 'apartment:change:confirm' }], menu] : [menu];
  }

  private getMembership(userId: string) {
    return prisma.residentMembership.findFirst({
      where: { userId, revokedAt: null },
      include: {
        apartment: {
          include: { building: { select: { entrancesCount: true, chatLink: true, address: true, street: true, companyId: true, city: true, longitude: true } } },
        },
      },
      orderBy: { verifiedAt: 'desc' },
    });
  }

  private async requestToJoin(maxUserId: string, userId: string, apartmentId: string) {
    await prisma.botSession.deleteMany({ where: { userId } });
    await createJoinRequest(userId, apartmentId);
    await this.showJoinWaiting(maxUserId, userId);
  }

  private async showJoinWaiting(maxUserId: string, userId: string) {
    const request = await pendingJoinRequest(userId);
    if (!request) {
      if (await this.getMembership(userId)) await this.showMainMenu(maxUserId);
      else await this.askApartmentCode(maxUserId, userId);
      return;
    }
    await prisma.botSession.deleteMany({ where: { userId } });
    const current = await this.getMembership(userId);
    await this.messenger.sendMessageToUser(maxUserId, blocks(
      [bold('Ждём подтверждения'), `${request.apartment.building.address}, кв. ${request.apartment.number}`],
      ['В этой квартире уже есть подключённые жители. Мы отправили им запрос: как только кто-то из них подтвердит, бот пришлёт вам сообщение.'],
      ['Если жители не отвечают, подтвердить подключение может управляющая компания. Без ответа запрос действует 7 дней.'],
      current ? [`Пока вы остаётесь привязаны к прежнему адресу: ${current.apartment.building.address}, кв. ${current.apartment.number}.`] : [],
    ), [
      [{ text: 'Отменить запрос', payload: 'join:cancel', intent: 'negative' }],
      [{ text: 'Выбрать другой адрес', payload: 'apartment:change:confirm' }],
      ...(current ? mainMenuLinkButtons() : [[{ text: 'Контакты УК', payload: 'uk:contacts' }, { text: 'Экстренные службы', payload: 'emergency:services' }]]),
    ]);
  }

  private async confirmApartmentMembership(maxUserId: string, userId: string, apartmentId: string, apartmentNumber?: string) {
    const previous = await this.getMembership(userId);
    const moved = Boolean(previous && previous.apartmentId !== apartmentId);
    const { stoppedSubscriptions } = await prisma.$transaction((tx) => bindResident(tx, userId, apartmentId));
    const confirmed = apartmentNumber ? `Квартира ${apartmentNumber} подтверждена` : 'Квартира подтверждена';

    // Everything the resident should decide after moving goes into one
    // message; with nothing to decide the main menu is shown right away.
    const notes: string[] = [];
    const buttons: CallbackButton[][] = [];
    if (moved && previous) {
      notes.push(`Вы сменили адрес. Уведомления по заявкам прежнего адреса отключены: ${stoppedSubscriptions}. Сами заявки остались в архиве «Мои заявки».`);
      if (await canClearApartmentData(userId, previous.apartmentId)) {
        notes.push(`В профиле прежней квартиры ${previous.apartment.number} (${previous.apartment.building.address}) остались ФИО, телефоны или автомобили. Новые жильцы смогут их увидеть.`);
        buttons.push([{ text: 'Очистить данные прежней квартиры', payload: `apartment:clear:${previous.apartmentId}`, intent: 'negative' }]);
      }
    }
    if (await canClearApartmentData(userId, apartmentId)) {
      notes.push('В профиле вашей новой квартиры остались данные прежних жильцов. Проверьте их в «Моя квартира» или удалите.');
      buttons.push([{ text: 'Очистить данные прежних жильцов', payload: `apartment:clear:${apartmentId}`, intent: 'negative' }]);
    }
    if (!notes.length) {
      await this.showMainMenu(maxUserId);
      return;
    }
    buttons.push([{ text: 'Оставить как есть, в главное меню', payload: 'menu:main' }]);
    await this.messenger.sendMessageToUser(maxUserId, blocks([bold(confirmed)], ...notes.map((note) => [note])), buttons);
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

const draftSchema = z.object({
  apartmentId: z.string().uuid(),
  buildingId: z.string().uuid(),
  category: z.enum(categoryValues as [IncidentCategory, ...IncidentCategory[]]),
  locationZone: z.string().min(1),
  entranceNumber: z.number().int().min(1).max(20).optional(),
  affectedApartmentNumber: z.string().trim().min(1).max(20).optional(),
  description: z.string().min(5).max(500),
  photos: z.array(z.object({ token: z.string(), url: z.string().optional() })).max(3).optional(),
});

type IncidentDraft = z.infer<typeof draftSchema>;

// Buttons from old messages can arrive while another dialog is active, so an
// incomplete draft is an expected situation rather than an exception.
function parseDraft(data: unknown): IncidentDraft | null {
  const parsed = draftSchema.safeParse(data);
  if (!parsed.success) return null;
  const draft = parsed.data;
  if ((draft.locationZone === 'entrance' || draft.locationZone === 'elevator') && !draft.entranceNumber) return null;
  return draft;
}

// The web desk for those who work in it: company staff and the platform.
async function deskButton(maxUserId: string): Promise<CallbackButton[][]> {
  const admin = await prisma.admin.findUnique({ where: { maxUserId }, select: { companyId: true, role: true, legalReminders: true } });
  if (!admin || (!admin.companyId && admin.role !== 'platform_admin')) return [];
  if (admin.role === 'platform_admin') return [[{ text: 'Веб-админка платформы', payload: 'desk:web' }]];
  return [
    [{ text: 'Веб-диспетчерская УК', payload: 'desk:web' }],
    [{ text: admin.legalReminders ? 'Напоминания о сроках: вкл.' : 'Напоминания о сроках: выкл.', payload: 'staff:reminders' }],
  ];
}

function mainMenuButtons(): CallbackButton[][] {
  return [
    [{ text: 'Сообщить о проблеме', payload: 'incident:create', intent: 'positive' }],
    [{ text: 'Открыть приложение', payload: 'home', openApp: true }],
    [{ text: 'Мои заявки', payload: 'incidents:list' }, { text: 'Заявки дома', payload: 'incidents:general' }],
    [{ text: 'Моя квартира', payload: 'profile:view' }, { text: 'Соседи', payload: 'neighbors:menu' }],
    [{ text: 'Объявления УК', payload: 'announcements:list' }, { text: 'Контакты УК', payload: 'uk:contacts' }],
    [{ text: 'Опросы УК', payload: 'polls:list' }, { text: 'Запись на приём', payload: 'appointments', openApp: true }],
    [{ text: 'Номера экстренных служб', payload: 'emergency:services' }],
    [{ text: 'Возможности бота', payload: 'bot:info' }],
  ];
}

// Apartment announcements are personal: a new resident does not see messages
// sent to the previous residents of the apartment.
function announcementFilter(membership: { apartmentId: string; verifiedAt: Date; apartment: { buildingId: string; building: { street: string; companyId: string } } }) {
  const { companyId } = membership.apartment.building;
  return {
    archivedAt: null,
    OR: [
      // "All" and "street" are addressed by one company to its own houses.
      { audience: 'all', companyId },
      { audience: 'street', street: membership.apartment.building.street, companyId },
      { audience: 'building', buildingId: membership.apartment.buildingId },
      { audience: 'apartment', apartmentId: membership.apartmentId, createdAt: { gte: membership.verifiedAt } },
    ],
  };
}


function mainMenuLinkButtons(): CallbackButton[][] {
  return [[{ text: 'В главное меню', payload: 'menu:main' }]];
}

function flowButtons(): CallbackButton[][] {
  return [[{ text: 'Отмена', payload: 'flow:cancel', intent: 'negative' }]];
}

function extractPhones(value: string): string[] {
  const candidates = value.match(/(?:\+?\s*[78])(?:[\s().-]*\d){10}/g) ?? [];
  return [...new Set(candidates.map(normalizeRussianPhone).filter((phone): phone is string => Boolean(phone)))];
}

function removePhones(value: string): string {
  return value.replace(/(?:\+?\s*[78])(?:[\s().-]*\d){10}/g, ' ');
}

// Photos from the chat carry a MAX token. Photos sent from the mini-app have
// none: MAX takes them by the public address of the photo.
function toMessengerImages(photos: Array<{ id?: string; token: string; url: string | null }>): ImageAttachment[] {
  return photos.flatMap((photo) => {
    if (!photo.token.startsWith('app:')) return [{ token: photo.token, ...(photo.url ? { url: photo.url } : {}) }];
    const url = photo.id ? publicPhotoUrl(photo.id) : null;
    return url ? [{ token: '', url }] : [];
  });
}

function allowedCategories(scope: SessionData['problemScope']): IncidentCategory[] {
  return scope === 'apartment' ? apartmentCategoryValues : categoryValues;
}


function expiresIn30Minutes() {
  return new Date(Date.now() + 30 * 60 * 1000);
}

function uniqueStreets(buildings: Array<{ id: string; street: string }>) {
  const seen = new Map<string, { id: string; street: string }>();
  for (const building of buildings) if (!seen.has(building.street)) seen.set(building.street, { id: building.id, street: building.street });
  return [...seen.values()];
}

function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Russian plates are often typed with spaces: "а 123 вс 72 Иван". A plate in
// the standard format is recognised with any spacing; otherwise the first word
// is taken as the plate.
const platePattern = /^\s*([a-zа-яё])\s*(\d{3})\s*([a-zа-яё]{2})\s*(\d{2,3})?(?=\s|,|$)/i;
function splitPlate(text: string): { licensePlate: string; rest: string } {
  const match = text.match(platePattern);
  if (match) return { licensePlate: normalizePlate(match.slice(1).join('')), rest: text.slice(match[0].length) };
  const first = text.trim().split(/[\s|,]+/)[0] ?? '';
  return { licensePlate: normalizePlate(first), rest: text.trim().slice(first.length) };
}

// The number of residents comes from the list of residents; a larger number
// can be set by hand for people who are not listed by name.
function residentsLine(manual: number | null, listed: number) {
  if (manual !== null && manual > listed) return `Проживает: ${manual}, известны по имени: ${listed}`;
  return listed ? `Проживает: ${listed}` : 'Проживает: не указано';
}

// Lays short buttons out in rows, for example incident numbers three per row.
function inRows(buttons: CallbackButton[], perRow: number): CallbackButton[][] {
  const rows: CallbackButton[][] = [];
  for (let index = 0; index < buttons.length; index += perRow) rows.push(buttons.slice(index, index + perRow));
  return rows;
}

function preview(text: string, length: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1).trimEnd()}…`;
}

// Long lists are shown page by page so the message stays readable and within
// the MAX length limit; a page number out of range shows the nearest page.
function pageOf(requested: number, total: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, Number.isInteger(requested) ? requested : 1), pages);
  return { page, pages, skip: (page - 1) * perPage };
}

function pageButtons(page: number, pages: number, listPayload: string): CallbackButton[][] {
  if (pages <= 1) return [];
  return [[
    ...(page > 1 ? [{ text: 'Предыдущие', payload: `${listPayload}:page:${page - 1}` }] : []),
    ...(page < pages ? [{ text: 'Следующие', payload: `${listPayload}:page:${page + 1}` }] : []),
  ]];
}

function pageLine(page: number, pages: number, total: number) {
  return pages > 1 ? `Всего ${total}, страница ${page} из ${pages}` : null;
}

// Buttons that work before a resident has an apartment: reference sections,
// choosing an address and answering or cancelling a join request.
const menuLater = 'Главное меню откроется, когда вы выберете дом и квартиру — здесь или в приложении.';

const openPayloads = new Set(['menu:main', 'flow:cancel', 'uk:contacts', 'uk:duties', 'emergency:services', 'bot:info', 'address:search', 'address:browse', 'city:change', 'desk:web', 'staff:reminders', 'staff:reminders:on', 'staff:reminders:off', 'apartment:change', 'apartment:change:confirm', 'join:cancel', 'join:status']);
const openPrefixes = ['consent:accept:', 'building:choose:', 'city:choose:', 'street:choose:', 'join:approve:', 'join:reject:', 'incident:accept:', 'incident:rate:', 'incident:reopen:', 'incident:reopen-now:'];
function opensWithoutAddress(payload: string) {
  return openPayloads.has(payload) || openPrefixes.some((prefix) => payload.startsWith(prefix));
}

// "Андрей (@andrew), +7 (900) 123-45-67" — what MAX tells about a resident.
function connectedLabel(user: { displayName: string | null; maxUsername: string | null; sharedPhone: string | null }) {
  const name = user.displayName?.trim() || 'Без имени в MAX';
  return `${name}${user.maxUsername ? ` (@${user.maxUsername})` : ''}${user.sharedPhone ? `, ${displayPhone(user.sharedPhone)}` : ''}`;
}

function pluralHouses(count: number) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return 'домов';
  if (units === 1) return 'дом';
  if (units >= 2 && units <= 4) return 'дома';
  return 'домов';
}

const zoneButtonLabels: Record<'entrance' | 'elevator' | 'yard' | 'common', string> = { entrance: 'Подъезд', elevator: 'Лифт', yard: 'Двор', common: 'Другое' };

// The privacy policy is a page next to the web desk.
function privacyUrl() {
  if (!env.MINIAPP_URL) return null;
  return new URL('/api/privacy/page', env.MINIAPP_URL).toString();
}
