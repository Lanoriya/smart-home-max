import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';

// What a management company owes its houses by law, with the longest terms.
// Checked against the current texts (legalacts.ru, October 2026):
// - ПП РФ № 416 от 15.05.2013 (ред. от 20.06.2026), пп. 13, 31, 34, 36;
// - ПП РФ № 354 от 06.05.2011, приложение № 1;
// - Постановление Госстроя РФ № 170 от 27.09.2003, приложение № 2;
// - ПП РФ № 290 от 03.04.2013 (ред. от 07.03.2025), пп. 23–25, 28.
// The platform administrator may change this text for everyone, and a
// company may keep its own version (for example with the shorter terms of its
// contracts).

export const dutiesSchema = z.array(z.object({
  title: z.string().trim().min(2).max(120),
  source: z.string().trim().max(200).default(''),
  items: z.array(z.string().trim().min(2).max(400)).min(1).max(20),
})).min(1).max(15);

export type Duties = z.infer<typeof dutiesSchema>;

export const lawDuties: Duties = [
  {
    title: 'Аварийно-диспетчерская служба',
    source: 'ПП РФ № 416 от 15.05.2013, п. 13',
    items: [
      'Ответить на телефонный звонок в аварийно-диспетчерскую службу — не более 5 минут.',
      'Локализовать аварийное повреждение внутридомовой инженерной системы — не более 30 минут.',
      'Ликвидировать засор канализации — в течение 2 часов.',
      'Ликвидировать засор мусоропровода — в течение 2 часов (с 8 до 23 часов).',
      'Устранить аварийное повреждение — не более 3 суток с даты повреждения.',
    ],
  },
  {
    title: 'Предельные сроки устранения неисправностей',
    source: 'Постановление Госстроя РФ № 170 от 27.09.2003, приложение № 2',
    items: [
      'Неисправности аварийного порядка трубопроводов (водопровод, канализация, ГВС, отопление, газ) — немедленно.',
      'Короткое замыкание во внутридомовой электросети — немедленно.',
      'Отключение питания дома или повреждение питающего кабеля — не более 2 часов.',
      'Вводно-распределительное устройство, автоматы защиты стояков и питающих линий — 3 часа.',
      'Неисправность лифта — не более 1 суток.',
      'Протечки в отдельных местах кровли — 1 сутки.',
      'Течь водопроводных кранов и сливных бачков — 1 сутки.',
      'Неисправности мусоропровода — 1 сутки.',
      'Входные двери в подъездах — 1 сутки.',
      'Разбитые стёкла: зимой — 1 сутки, летом — 3 суток.',
      'Протечки в перекрытиях из-за гидроизоляции полов санузлов — 3 суток.',
      'Повреждения системы организованного водоотвода с крыши — 5 суток.',
      'Освещение помещений общего пользования (лампы, выключатели, светильники) — 7 суток.',
    ],
  },
  {
    title: 'Допустимые перерывы в коммунальных услугах',
    source: 'ПП РФ № 354 от 06.05.2011, приложение № 1',
    items: [
      'Холодная вода — не более 8 часов в месяц суммарно и 4 часов подряд.',
      'Горячая вода — не более 8 часов в месяц суммарно и 4 часов подряд; при аварии на тупиковой магистрали — 24 часа подряд.',
      'Водоотведение — не более 8 часов в месяц суммарно и 4 часов подряд.',
      'Электричество — 2 часа при двух независимых источниках питания, 24 часа при одном.',
      'Газ — не более 4 часов в месяц суммарно.',
      'Отопление — не более 24 часов в месяц суммарно и 16 часов подряд.',
    ],
  },
  {
    title: 'Обращения и информирование жителей',
    source: 'ПП РФ № 416 от 15.05.2013, пп. 31, 34, 36',
    items: [
      'Ответить на обращение собственника по прочим вопросам — не более 10 рабочих дней.',
      'Справочные сведения по запросу — не позднее следующего дня; письменные сведения о потреблении — не позднее 3 рабочих дней.',
      'О плановых работах и перерывах в услугах — предупредить не позднее чем за 3 рабочих дня.',
    ],
  },
  {
    title: 'Содержание дома и двора',
    source: 'ПП РФ № 290 от 03.04.2013, пп. 23–25, 28',
    items: [
      'Сухая и влажная уборка тамбуров, холлов, коридоров, лифтовых площадок и холлов, лестниц.',
      'Зимой — сдвигание свежевыпавшего снега, очистка территории от снега и льда, от наледи.',
      'Летом — подметание и уборка придомовой территории, уборка и выкашивание газонов.',
      'Устранение аварий на внутридомовых инженерных системах в установленные предельные сроки.',
      'Периодичность работ определяется договором управления и графиком УК.',
    ],
  },
];

const platformKey = 'duties';

// The text residents see: the company's own, else the platform's, else the law.
export async function dutiesFor(companyId: string | null) {
  if (companyId) {
    const company = await prisma.managementCompany.findUnique({ where: { id: companyId }, select: { duties: true } });
    const own = dutiesSchema.safeParse(company?.duties);
    if (own.success) return { items: own.data, own: true };
  }
  return { items: await platformDuties(), own: false };
}

export async function platformDuties(): Promise<Duties> {
  const row = await prisma.platformSetting.findUnique({ where: { key: platformKey } });
  const parsed = dutiesSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : lawDuties;
}

export async function savePlatformDuties(items: Duties | null) {
  if (!items) { await prisma.platformSetting.deleteMany({ where: { key: platformKey } }); return lawDuties; }
  await prisma.platformSetting.upsert({ where: { key: platformKey }, create: { key: platformKey, value: items }, update: { value: items } });
  return items;
}

export async function saveCompanyDuties(companyId: string, items: Duties | null) {
  await prisma.managementCompany.update({ where: { id: companyId }, data: { duties: items ?? Prisma.DbNull } });
  return dutiesFor(companyId);
}
