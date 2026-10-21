import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { escapeHtml } from '../shared/html.js';

// The privacy policy of the service. The platform administrator edits it in
// the web admin; the mini-app shows it on its own screen, the bot links to a
// page built from the same text.

export const privacySchema = z.object({
  title: z.string().trim().min(3).max(200),
  intro: z.string().trim().max(3000).default(''),
  sections: z.array(z.object({
    title: z.string().trim().min(2).max(200),
    text: z.string().trim().min(2).max(5000),
  })).min(1).max(30),
});

export type Privacy = z.infer<typeof privacySchema>;

export const defaultPrivacy: Privacy = {
  title: 'Политика обработки персональных данных',
  intro: 'Политика составлена в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных». Подключаясь к дому, вы даёте согласие на обработку данных, перечисленных ниже, для указанных целей. Без согласия к дому подключиться нельзя, но карту, номера экстренных служб и сведения об УК можно смотреть и без него.',
  sections: [
    { title: 'Кто обрабатывает данные', text: 'Оператор — команда проекта «Домовед». Данные о заявках и жителях дома также получает управляющая компания этого дома: она обрабатывает их, чтобы выполнять свои обязанности по договору управления.' },
    { title: 'Какие данные мы храним', text: 'Идентификатор, имя и ник из профиля MAX.\nАдрес дома и номер квартиры.\nЗаявки, комментарии и фотографии, которые вы отправили.\nНомер телефона — только если вы сами им поделились.\nНомер автомобиля — только если вы сами его добавили.\nСлужебные сведения: время подключения, согласия и обращений.\nМы не запрашиваем паспортные данные, не храним платёжные данные и не используем данные для рекламы.' },
    { title: 'Зачем', text: 'Принимать заявки о проблемах в доме и передавать их управляющей компании.\nСообщать о ходе работ, объявлениях и авариях.\nОбъединять одинаковые обращения соседей в одну заявку.\nСвязывать соседей — только в объёме, который вы разрешили (например, по номеру автомобиля).' },
    { title: 'Кто видит данные', text: 'Ваша управляющая компания — заявки, адрес, квартира и имя.\nСоседи — общие заявки дома без имён; телефон и автомобиль — только с вашего разрешения.\nТретьим лицам данные не передаются, кроме случаев, предусмотренных законом.' },
    { title: 'Сколько храним', text: 'Пока вы подключены к дому. Когда вы отвязываетесь от квартиры, согласие отзывается: привязка, телефон и автомобили удаляются. Заявки остаются в истории управляющей компании, так как нужны для учёта выполненных работ.' },
    { title: 'Ваши права', text: 'Вы можете узнать, какие данные о вас хранятся, исправить их или потребовать удалить (ст. 14 152-ФЗ), а также отозвать согласие. Отозвать согласие можно в любой момент: в боте — «Моя квартира» → «Отвязаться от квартиры», в приложении — «Ещё» → «Отвязаться от квартиры». Запрос можно отправить через бота «Домовед» в MAX.' },
    { title: 'Защита', text: 'Доступ к данным есть только у сотрудников вашей управляющей компании и администраторов сервиса. Сотрудники входят через MAX или по паролю, который хранится только в виде хеша; соединение защищено (HTTPS).' },
  ],
};

const key = 'privacy';

export async function getPrivacy(): Promise<Privacy> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  const parsed = privacySchema.safeParse(row?.value);
  return parsed.success ? parsed.data : defaultPrivacy;
}

export async function savePrivacy(value: Privacy | null) {
  if (!value) { await prisma.platformSetting.deleteMany({ where: { key } }); return defaultPrivacy; }
  await prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return value;
}

// A plain page for the link in the bot.
export function privacyPage(value: Privacy) {
  const paragraphs = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(value.title)} — Домовед</title>
<style>:root{--ink:#1b2430;--muted:#5b6675;--line:#d9dee5;--page:#f6f8fa;--surface:#fff}@media (prefers-color-scheme:dark){:root{--ink:#e6eaf0;--muted:#9aa6b4;--line:#2a313b;--page:#0e1116;--surface:#161b22}}body{margin:0;background:var(--page);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}main{max-width:760px;margin:0 auto;padding:32px 16px 56px}h1{margin:0 0 12px;font-size:26px;line-height:1.25}h2{margin:28px 0 8px;font-size:18px}p{margin:0 0 8px}.card{padding:16px 18px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}</style></head>
<body><main><h1>${escapeHtml(value.title)}</h1>${value.intro ? `<div class="card">${paragraphs(value.intro)}</div>` : ''}${value.sections.map((section, index) => `<h2>${index + 1}. ${escapeHtml(section.title)}</h2>${paragraphs(section.text)}`).join('')}</main></body></html>`;
}
