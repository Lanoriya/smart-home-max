import { FormEvent, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError, plural } from './api';

// Two ways in for those who do not write to the bot themselves: a dispatcher
// registers a phone call as an incident, and a QR code at the entrance opens
// the bot with the house already chosen.

type Notify = (text: string, tone?: 'success' | 'error') => void;
type HouseOption = { id: string; address: string; street: string; entrancesCount: number };

const categories: Array<[string, string]> = [['water', 'Водоснабжение'], ['electricity', 'Электричество'], ['heating', 'Отопление'], ['elevator', 'Лифт'], ['leak', 'Протечка'], ['cleaning', 'Уборка'], ['other', 'Другое']];
const zones: Array<[string, string]> = [['apartment', 'В квартире'], ['entrance', 'В подъезде'], ['elevator', 'В лифте'], ['yard', 'Во дворе'], ['common', 'Другое общедомовое']];
// The same rules as for residents: where a problem of each kind can be.
const zonesByCategory: Record<string, string[]> = {
  water: ['apartment', 'common'], electricity: ['apartment', 'entrance', 'yard', 'common'], heating: ['apartment', 'entrance', 'common'], elevator: ['elevator'],
  leak: ['apartment', 'entrance', 'common'], cleaning: ['entrance', 'elevator', 'yard', 'common'], other: ['apartment', 'entrance', 'elevator', 'yard', 'common'],
};
const errors: Record<string, string> = {
  apartment_not_found: 'Такой квартиры в доме нет. Проверьте номер.',
  apartment_required: 'Для проблемы в квартире укажите номер квартиры.',
  entrance_required: 'Укажите подъезд: он не больше числа подъездов дома.',
  zone_not_for_category: 'Для этого типа проблемы такое место не подходит.',
  invalid_phone: 'Телефон не похож на российский номер. Пример: +7 900 123-45-67.',
  building_not_found: 'Дом не найден. Обновите страницу.',
};

// ---------- a phone call ----------

export function PhoneIncidentDrawer({ buildings, onClose, onCreated, onNotice }: { buildings: HouseOption[]; onClose: () => void; onCreated: (id: string) => Promise<void>; onNotice: Notify }) {
  const [buildingId, setBuildingId] = useState(buildings.length === 1 ? buildings[0]!.id : '');
  const [apartmentNumber, setApartmentNumber] = useState('');
  const [category, setCategory] = useState('water');
  const [zone, setZone] = useState('apartment');
  const [entrance, setEntrance] = useState('1');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const building = buildings.find((item) => item.id === buildingId);
  const allowedZones = zones.filter(([key]) => zonesByCategory[category]!.includes(key));
  const needsEntrance = zone === 'entrance' || zone === 'elevator';
  const streets = [...new Set(buildings.map((item) => item.street))];

  function pickCategory(next: string) {
    setCategory(next);
    if (!zonesByCategory[next]!.includes(zone)) setZone(zonesByCategory[next]![0]!);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!buildingId) { setError('Выберите дом.'); return; }
    if (zone === 'apartment' && !apartmentNumber.trim()) { setError(errors.apartment_required!); return; }
    setBusy(true);
    try {
      const result = await api<{ item: { id: string; number: number }; notified: number; apartmentInService: boolean }>('/api/incidents', { method: 'POST', body: JSON.stringify({
        buildingId, category, locationZone: zone, priority, description: description.trim(),
        entranceNumber: needsEntrance ? Number(entrance) : null,
        apartmentNumber: apartmentNumber.trim() || null,
        callerName: callerName.trim() || null,
        callerPhone: callerPhone.trim() || null,
      }) });
      onNotice(result.notified
        ? `Заявка № ${result.item.number} создана. ${result.notified} ${plural(result.notified, 'житель квартиры получил', 'жителя квартиры получили', 'жителей квартиры получили')} её в MAX.`
        : `Заявка № ${result.item.number} создана. Назовите номер звонившему: жителей этой квартиры в MAX пока нет.`);
      await onCreated(result.item.id);
    } catch (requestError) {
      setError(requestError instanceof ApiError && requestError.code && errors[requestError.code] ? errors[requestError.code]! : 'Не удалось создать заявку. Проверьте поля: описание — от 5 символов.');
    } finally { setBusy(false); }
  }

  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="drawer" aria-label="Заявка по звонку"><button className="drawer-close" type="button" onClick={onClose} aria-label="Закрыть">×</button>
      <h2>Заявка по звонку</h2>
      <p className="drawer-meta">Заявка встанет в общую очередь со статусом «Принята». Если жители квартиры есть в MAX, они получат её в чат с ботом и будут видеть статус, ответы УК и смогут подтвердить результат.</p>
      <form className="status-form intake-form" onSubmit={submit}>
        <label>Дом<select required value={buildingId} onChange={(event) => { setBuildingId(event.target.value); setEntrance('1'); }}>
          <option value="">Выберите дом</option>
          {streets.map((street) => <optgroup key={street} label={street}>{buildings.filter((item) => item.street === street).map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}</optgroup>)}
        </select></label>
        <label>Квартира звонившего<input inputMode="text" maxLength={20} value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} placeholder="Например, 45" /><span className="field-hint">{zone === 'apartment' ? 'Обязательно для проблемы в квартире.' : 'Необязательно. Если указать, жители этой квартиры будут получать статус заявки в MAX.'}</span></label>
        <div className="intake-row">
          <label>Тип проблемы<select value={category} onChange={(event) => pickCategory(event.target.value)}>{categories.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
          <label>Где<select value={zone} onChange={(event) => setZone(event.target.value)}>{allowedZones.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
          {needsEntrance ? <label>Подъезд<select value={entrance} onChange={(event) => setEntrance(event.target.value)}>{Array.from({ length: building?.entrancesCount ?? 1 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label> : null}
          <label>Срочность<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="normal">Обычная</option><option value="high">Срочная</option><option value="emergency">Авария</option></select></label>
        </div>
        <label>Что случилось<textarea required minLength={5} maxLength={1000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Например: с утра нет горячей воды, на кухне и в ванной" /><span className="field-hint">Первые 70 символов станут заголовком заявки.</span></label>
        <div className="intake-row">
          <label>Имя звонившего<input maxLength={120} value={callerName} onChange={(event) => setCallerName(event.target.value)} placeholder="Необязательно" /></label>
          <label>Телефон<input type="tel" maxLength={40} value={callerPhone} onChange={(event) => setCallerPhone(event.target.value)} placeholder="+7 900 123-45-67" /></label>
        </div>
        <p className="form-hint">Имя и телефон видят только сотрудники УК.</p>
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Создаём…' : 'Создать заявку'}</button>
      </form>
    </aside>
  </div>;
}

// ---------- the QR code of a house ----------

type HouseLink = { link: string; address: string; companyName: string; companyPhone: string };

export function HouseQrButton({ buildingId, onNotice }: { buildingId: string; onNotice: Notify }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="filter" type="button" onClick={() => setOpen(true)}>QR-код для подъезда</button>
    {open ? <HouseQr buildingId={buildingId} onClose={() => setOpen(false)} onNotice={onNotice} /> : null}
  </>;
}

function HouseQr({ buildingId, onClose, onNotice }: { buildingId: string; onClose: () => void; onNotice: Notify }) {
  const [house, setHouse] = useState<HouseLink | null>(null);
  const [svg, setSvg] = useState('');
  useEffect(() => {
    void api<HouseLink>(`/api/buildings/${buildingId}/resident-link`).then(async (value) => {
      setHouse(value);
      setSvg(await QRCode.toString(value.link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } }));
    }).catch((error: unknown) => {
      onNotice(error instanceof ApiError && error.code === 'bot_username_missing' ? 'Не задано имя бота (MAX_BOT_USERNAME): ссылку для QR-кода не собрать.' : 'Не удалось получить ссылку дома.', 'error');
      onClose();
    });
  }, [buildingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    if (!house) return;
    try { await navigator.clipboard.writeText(house.link); onNotice('Ссылка скопирована.'); } catch { onNotice('Не удалось скопировать ссылку.', 'error'); }
  };
  // The poster opens as a page of its own, so the print has nothing of the desk.
  const print = () => {
    if (!house || !svg) return;
    const page = window.open('', '_blank');
    if (!page) { onNotice('Браузер не дал открыть окно печати. Разрешите всплывающие окна для этого сайта.', 'error'); return; }
    page.document.write(posterHtml(house, svg));
    page.document.close();
    page.focus();
    setTimeout(() => page.print(), 300);
  };

  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="drawer" aria-label="QR-код дома"><button className="drawer-close" type="button" onClick={onClose} aria-label="Закрыть">×</button>
      <h2>QR-код для подъезда</h2>
      <p className="drawer-meta">{house?.address ?? 'Загружаем…'}</p>
      <p className="form-hint">Распечатайте листовку и повесьте у входа или у лифта. Житель наводит камеру — открывается бот в MAX, где дом уже выбран. Остаётся указать квартиру и подтвердить её кодом дома или номером договора, как обычно. Сам QR-код доступа к квартире не даёт.</p>
      {svg ? <div className="qr-preview" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="state-message">Готовим QR-код…</p>}
      {house ? <code className="qr-link">{house.link}</code> : null}
      <div className="form-actions"><button className="primary" type="button" disabled={!svg} onClick={print}>Распечатать листовку</button><button className="filter" type="button" disabled={!house} onClick={() => void copy()}>Скопировать ссылку</button></div>
    </aside>
  </div>;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function posterHtml(house: HouseLink, svg: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Домовед — ${escapeHtml(house.address)}</title><style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; }
.poster { max-width: 180mm; margin: 0 auto; padding: 10mm 6mm; text-align: center; }
h1 { margin: 0 0 4mm; font-size: 30pt; line-height: 1.1; }
.lead { margin: 0 0 8mm; font-size: 15pt; color: #333; }
.qr { width: 95mm; height: 95mm; margin: 0 auto 6mm; }
.qr svg { width: 100%; height: 100%; }
.address { margin: 0 0 8mm; font-size: 17pt; font-weight: 700; }
ol { display: inline-block; margin: 0 0 8mm; padding-left: 7mm; text-align: left; font-size: 13pt; line-height: 1.55; }
.can { margin: 0 0 8mm; font-size: 12pt; color: #333; }
.foot { margin: 0; font-size: 11pt; color: #555; }
</style></head><body><div class="poster">
<h1>Наш дом в MAX</h1>
<p class="lead">Сообщить о проблеме в управляющую компанию — за минуту, без звонков</p>
<div class="qr">${svg}</div>
<p class="address">${escapeHtml(house.address)}</p>
<ol><li>Наведите камеру телефона на QR-код</li><li>Откроется бот «Домовед» в MAX — дом уже выбран</li><li>Укажите номер квартиры и код дома или номер договора от УК</li></ol>
<p class="can">Заявки и их статус · сроки по закону · объявления УК · опросы дома · связь с соседями</p>
<p class="foot">${escapeHtml(house.companyName)}${house.companyPhone ? ` · ${escapeHtml(house.companyPhone)}` : ''}</p>
</div></body></html>`;
}
