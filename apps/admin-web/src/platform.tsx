import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { api, ApiError, plural } from './api';
import { formatFullDate } from './zones';

// Leaflet needs a browser: the map is loaded only when it is shown.
const ConnectMap = lazy(() => import('./connect-map'));

// The platform in the web admin: every management company side by side, the
// card and staff of each, and connecting a company with all its houses — the
// same as in the mini-app, on a big screen.

type Notify = (text: string, tone?: 'success' | 'error') => void;
type Stats = { open: number; overdue: number; residents: number; buildings: number; incidents: number; reactionMinutesMedian: number | null; onTimeShare: number | null };
export type PlatformCompany = { id: string; name: string; phone: string; address?: string | null; cities?: string[]; latitude?: number | null; longitude?: number | null; buildingsCount: number; adminsCount: number; apartmentsCount: number; entrancesCount: number; stats: Stats };
type Overview = { total: Stats; companies: PlatformCompany[] };
type CompanyCard = { id: string; name: string; phone: string; inn: string | null; ogrn: string | null; email: string | null; site: string | null; address: string | null; workingHours: string | null; receptionHours: string | null; daysOff: string | null; cleaningInfo: string | null; note: string | null; latitude: number | null; longitude: number | null };
type Staff = { id: string; name: string; viaMax: boolean; createdAt: string };
type Invite = { link: string | null; expiresAt: string };

const app = (path: string) => `/api/app${path}`;

export function loadOverview() {
  return api<Overview>(app('/platform/overview'));
}

function duration(minutes: number | null) {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const hours = minutes / 60;
  return hours < 48 ? `${Math.round(hours)} ч` : `${Math.round(hours / 24)} дн`;
}
const percent = (share: number | null) => (share === null ? '—' : `${Math.round(share * 100)}%`);

// ---------- all companies ----------

export function PlatformOverview({ onOpenDesk, onConnect, onNotice }: { onOpenDesk: (company: { id: string; name: string }) => void; onConnect: (companyId?: string) => void; onNotice: Notify }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const reload = async () => {
    try { setData(await loadOverview()); setError(''); } catch { setError('Не удалось загрузить управляющие компании: нет связи с сервером.'); }
  };
  useEffect(() => { void reload(); }, []);
  if (error) return <p className="state-message error">{error} <button className="text-button" type="button" onClick={() => void reload()}>Повторить</button></p>;
  if (!data) return <p className="state-message">Загружаем управляющие компании…</p>;
  const { total, companies } = data;
  const words = query.trim().toLowerCase();
  const fold = (value: string) => value.toLowerCase().replace(/ё/g, 'е');
  const visible = words ? companies.filter((company) => [company.name, company.address ?? '', ...(company.cities ?? [])].some((value) => fold(value).includes(fold(words)))) : companies;
  return <>
    <section className="stats" aria-label="Платформа целиком">
      <article><strong>{companies.length}</strong><span>{plural(companies.length, 'управляющая компания', 'управляющие компании', 'управляющих компаний')}</span></article>
      <article><strong>{total.buildings}</strong><span>{plural(total.buildings, 'дом подключён', 'дома подключены', 'домов подключено')}</span></article>
      <article><strong>{total.residents}</strong><span>{plural(total.residents, 'житель в сервисе', 'жителя в сервисе', 'жителей в сервисе')}</span></article>
      <article className="accent" title="Заявки без статуса «Устранена» или «Отклонена» во всех УК"><strong>{total.open}</strong><span>открытых заявок</span></article>
    </section>
    <section className="panel">
      <div className="panel-head">
        <div><h2>Управляющие компании</h2><p className="form-hint">Откройте пульт УК, чтобы работать с её заявками, домами и жителями как её сотрудник. Карточка — контакты, сотрудники, приглашение и удаление.</p></div>
        <div className="panel-actions">
          <label className="incident-sort">Поиск<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или город" /></label>
          <button className="primary" type="button" onClick={() => onConnect()}>Подключить УК</button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>УК</th><th>Домов</th><th>Квартир</th><th>Жителей</th><th>Открыто</th><th title="Медиана времени от заявки до первого ответа УК">Реакция</th><th title="Доля заявок, закрытых в назначенный срок">В срок</th><th>Сотрудники</th><th /></tr></thead>
          <tbody>
            {visible.map((company) => (
              <tr key={company.id}>
                <td><button type="button" className="link-cell" onClick={() => setOpen(company.id)}>{company.name}</button><small>{[company.cities?.join(', '), company.phone].filter(Boolean).join(' · ')}</small></td>
                <td>{company.buildingsCount}</td>
                <td>{company.apartmentsCount}</td>
                <td>{company.stats.residents}</td>
                <td>{company.stats.open ? <span className={company.stats.overdue ? 'badge rejected' : 'badge new'}>{company.stats.open}{company.stats.overdue ? `, просрочено ${company.stats.overdue}` : ''}</span> : '0'}</td>
                <td>{duration(company.stats.reactionMinutesMedian)}</td>
                <td>{percent(company.stats.onTimeShare)}</td>
                <td>{company.adminsCount ? company.adminsCount : <span className="badge new">нет</span>}</td>
                <td className="row-actions"><button className="filter" type="button" onClick={() => onOpenDesk(company)}>Пульт УК</button><button className="filter" type="button" onClick={() => setOpen(company.id)}>Карточка</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length ? <p className="state-message">{words ? `По запросу «${query}» УК не найдены.` : 'Управляющих компаний пока нет. Подключите первую.'}</p> : null}
      </div>
    </section>
    {open ? <CompanyDrawer companyId={open} summary={companies.find((item) => item.id === open) ?? null} onClose={() => setOpen(null)} onChanged={reload} onDeleted={() => { setOpen(null); void reload(); }} onOpenDesk={onOpenDesk} onConnect={onConnect} onNotice={onNotice} /> : null}
  </>;
}

// ---------- the card of one company ----------

function CompanyDrawer({ companyId, summary, onClose, onChanged, onDeleted, onOpenDesk, onConnect, onNotice }: {
  companyId: string; summary: PlatformCompany | null; onClose: () => void; onChanged: () => Promise<void>; onDeleted: () => void;
  onOpenDesk: (company: { id: string; name: string }) => void; onConnect: (companyId?: string) => void; onNotice: Notify;
}) {
  const [card, setCard] = useState<CompanyCard | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadStaff = async () => { try { setStaff((await api<{ items: Staff[] }>(app(`/platform/companies/${companyId}/admins`))).items); } catch { setStaff([]); } };
  useEffect(() => {
    void api<{ item: CompanyCard }>(app(`/platform/companies/${companyId}`)).then(({ item }) => {
      setCard(item);
      setForm(Object.fromEntries(fields.map(([key]) => [key, (item[key] as string | null) ?? ''])));
    }).catch(() => setError('Не удалось загрузить карточку УК.'));
    void loadStaff();
  }, [companyId]);
  const field = (key: keyof CompanyCard) => ({ value: form[key] ?? '', onChange: (event: { target: { value: string } }) => setForm((value) => ({ ...value, [key]: event.target.value })) });
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!card) return;
    setBusy(true); setError('');
    // The office point stays where it is unless the address changed: then it
    // is found again by the new address.
    const moved = (form.address ?? '') !== (card.address ?? '');
    try {
      const { item } = await api<{ item: CompanyCard }>(app(`/platform/companies/${companyId}`), { method: 'PATCH', body: JSON.stringify({ ...form, latitude: moved ? null : card.latitude, longitude: moved ? null : card.longitude }) });
      setCard(item);
      onNotice('Карточка УК сохранена.');
      await onChanged();
    } catch { setError('Не удалось сохранить: проверьте название, телефон (российский номер), ИНН (10 или 12 цифр) и email.'); } finally { setBusy(false); }
  }
  async function removeStaff(person: Staff) {
    if (!window.confirm(`Убрать «${person.name}» из сотрудников УК? Доступ к пульту пропадёт сразу.`)) return;
    try { await api(app(`/platform/admins/${person.id}`), { method: 'DELETE' }); onNotice(`${person.name} больше не сотрудник УК.`); await loadStaff(); await onChanged(); } catch { onNotice('Не удалось убрать сотрудника.', 'error'); }
  }
  async function createInvite() {
    try { setInvite(await api<Invite>(app(`/platform/companies/${companyId}/invites`), { method: 'POST', body: JSON.stringify({ role: 'supervisor' }) })); } catch { onNotice('Не удалось создать приглашение.', 'error'); }
  }
  async function remove() {
    // A company with houses goes together with them, after a plain warning;
    // houses to keep are handed to another company first.
    const houses = summary?.buildingsCount ?? 0;
    const residents = summary?.stats.residents ?? 0;
    const text = houses
      ? `Удалить «${card?.name ?? 'УК'}» вместе с ${houses} ${plural(houses, 'домом', 'домами', 'домами')}?\n\nУдалятся квартиры и заявки этих домов, ${residents} ${plural(residents, 'житель будет отключён', 'жителя будут отключены', 'жителей будут отключены')}, сотрудники потеряют доступ. Действие нельзя отменить.\n\nДома, которые нужно сохранить, сначала передайте другой УК: «Пульт УК» → «Дома» → «Передать другой УК».`
      : `Удалить «${card?.name ?? 'УК'}»? Её объявления, службы и приглашения удалятся, сотрудники потеряют доступ.`;
    if (!window.confirm(text)) return;
    try { await api(app(`/platform/companies/${companyId}${houses ? '?withBuildings=true' : ''}`), { method: 'DELETE' }); onNotice(houses ? 'УК и её дома удалены.' : 'УК удалена.'); onDeleted(); } catch (failure) { onNotice(failure instanceof ApiError && failure.code === 'company_has_buildings' ? 'У этой УК есть дома. Сначала передайте их другой УК.' : 'Не удалось удалить УК.', 'error'); }
  }
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); onNotice('Ссылка скопирована.'); } catch { onNotice('Скопируйте ссылку вручную.', 'error'); } };
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="drawer">
      <button className="drawer-close" type="button" onClick={onClose} aria-label="Закрыть">×</button>
      <h2>{card?.name ?? summary?.name ?? 'Управляющая компания'}</h2>
      {summary ? <p className="drawer-meta">{summary.buildingsCount} {plural(summary.buildingsCount, 'дом', 'дома', 'домов')}, {summary.apartmentsCount} {plural(summary.apartmentsCount, 'квартира', 'квартиры', 'квартир')}, {summary.stats.residents} {plural(summary.stats.residents, 'житель', 'жителя', 'жителей')} в сервисе</p> : null}
      <div className="form-actions drawer-actions">
        <button className="primary" type="button" onClick={() => onOpenDesk({ id: companyId, name: card?.name ?? summary?.name ?? 'УК' })}>Открыть пульт УК</button>
        <button className="filter" type="button" onClick={() => onConnect(companyId)}>Подключить дома</button>
      </div>
      {card ? <form className="status-form" onSubmit={save}>
        <h3>Карточка для жителей</h3>
        {fields.map(([key, label, hint]) => <label key={key}>{label}{key === 'note' || key === 'cleaningInfo' ? <textarea rows={3} maxLength={1000} {...field(key)} /> : <input maxLength={key === 'name' ? 200 : 300} required={key === 'name' || key === 'phone'} {...field(key)} />}{hint ? <span className="field-hint">{hint}</span> : null}</label>)}
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить карточку'}</button>
      </form> : error ? <p className="form-error">{error}</p> : <p className="form-hint">Загружаем карточку…</p>}
      <section className="status-form">
        <h3>Сотрудники</h3>
        {staff === null ? <p className="form-hint">Загружаем…</p> : staff.length ? staff.map((person) => <div className="staff-row" key={person.id}><span><strong>{person.name}</strong><small>{person.viaMax ? 'входит через MAX' : 'без MAX'}</small></span><button className="filter danger" type="button" onClick={() => void removeStaff(person)}>Убрать</button></div>) : <p className="form-hint">Сотрудников пока нет. Пригласите администратора УК: он откроет ссылку в MAX и получит пульт.</p>}
        {invite ? <div className="invite-box"><p className="form-hint">Ссылка одноразовая, действует до {formatFullDate(invite.expiresAt)}. Отправьте её администратору УК.</p>{invite.link ? <div className="secret-row"><input readOnly value={invite.link} onFocus={(event) => event.target.select()} /><button className="primary" type="button" onClick={() => void copy(invite.link!)}>Скопировать</button></div> : <p className="form-error">Ссылка не собралась: у бота не задано имя (MAX_BOT_USERNAME).</p>}</div> : <button className="filter" type="button" onClick={() => void createInvite()}>Пригласить администратора УК</button>}
      </section>
      <section className="status-form danger-zone">
        <h3>Удаление</h3>
        <p className="form-hint">УК удаляется вместе с домами, их квартирами и заявками; жители этих домов отключаются, сотрудники теряют доступ. Дома, которые нужно сохранить, сначала передайте другой УК.</p>
        <button className="filter danger" type="button" onClick={() => void remove()}>Удалить УК</button>
      </section>
    </div>
  </div>;
}

const fields: Array<[keyof CompanyCard, string, string?]> = [
  ['name', 'Название'],
  ['phone', 'Телефон для жителей', 'Российский номер, в любом привычном виде.'],
  ['inn', 'ИНН', '10 или 12 цифр, необязательно.'],
  ['email', 'Email'],
  ['site', 'Сайт'],
  ['address', 'Адрес офиса', 'Офис ставится на карту по адресу.'],
  ['workingHours', 'Часы работы'],
  ['receptionHours', 'Приём граждан'],
  ['daysOff', 'Выходные дни'],
  ['cleaningInfo', 'Уборка и благоустройство', 'Что и как часто убирается — жители видят в «Моя УК».'],
  ['note', 'Дополнительно'],
];

// ---------- connecting a company and its houses ----------

export type CitySuggestion = { name: string; region: string | null; latitude: number; longitude: number; extent?: [number, number, number, number] | null };
type RegistryCompany = { id: string; subject: string; nameFull: string; nameShort: string | null; inn: string | null; ogrn: string | null; legalAddress: string | null; actualAddress: string | null; phone: string | null; email: string | null; site: string | null; housesCount: number | null; connectedCompanyId: string | null };
type HouseLookup = {
  address: { street: string; house: string; locality: string | null } | null;
  details: { floors: number | null; apartments: number | null; builtYear: number | null; fiasGuid: string | null };
  existing: { id: string; address: string; company: { id: string; name: string } } | null;
};
export type MapData = { buildings: Array<{ id: string; address: string; companyId: string; latitude: number | null; longitude: number | null }> };
export type Point = { latitude: number; longitude: number };
type Chosen = { id: string | null; name: string; phone: string; inn: string | null; ogrn: string | null; email: string | null; site: string | null; address: string | null };
type Row = { key: string; source: string; status: 'ready' | 'needs' | 'exists' | 'missing' | 'added' | 'failed'; note?: string; street: string; house: string; apartments: string; entrances: string; point: Point | null; floors: number | null; builtYear: number | null; fiasGuid: string | null; city: string | null };

const maxRows = 60;
const statusText: Record<Row['status'], string> = { ready: 'готов', needs: 'нужны данные', exists: 'уже в сервисе', missing: 'не найден', added: 'подключён', failed: 'ошибка' };
const statusTone: Record<Row['status'], string> = { ready: 'resolved', needs: 'new', exists: 'acknowledged', missing: 'rejected', added: 'resolved', failed: 'rejected' };

function cityQuery(city: CitySuggestion) {
  return new URLSearchParams({ city: city.name, lat: String(city.latitude), lng: String(city.longitude), ...(city.region ? { region: city.region } : {}), ...(city.extent ? { extent: city.extent.join(',') } : {}) });
}
function distance(left: Point, right: Point) {
  const dy = (left.latitude - right.latitude) * 111_320;
  const dx = (left.longitude - right.longitude) * 111_320 * Math.cos((left.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
function sameHouse(left: Row, right: Row) {
  const fold = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[\s.,]/g, '');
  return Boolean(left.street && left.house) && fold(left.street) === fold(right.street) && fold(left.house) === fold(right.house);
}
function estimateEntrances(apartments: number, floors: number | null) {
  return String(Math.max(1, Math.round(apartments / Math.max(1, (floors ?? 5) * 4))));
}

async function recognise(point: Point, source: string): Promise<Row> {
  const lookup = await api<HouseLookup>(app('/lookup'), { method: 'POST', body: JSON.stringify(point) });
  const apartments = lookup.details.apartments ?? null;
  const row: Row = {
    key: `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`, source, status: 'ready',
    street: lookup.address?.street ?? '', house: lookup.address?.house ?? '',
    apartments: apartments ? String(apartments) : '', entrances: apartments ? estimateEntrances(apartments, lookup.details.floors) : '',
    point, floors: lookup.details.floors, builtYear: lookup.details.builtYear, fiasGuid: lookup.details.fiasGuid, city: lookup.address?.locality ?? null,
  };
  if (lookup.existing) return { ...row, status: 'exists', note: `уже в сервисе, УК «${lookup.existing.company.name}»` };
  if (!row.street || !row.house) return { ...row, status: 'missing', note: 'здание не распознано как жилой дом' };
  if (!apartments) return { ...row, status: 'needs', note: 'укажите число квартир и подъездов' };
  return row;
}

export function PlatformConnect({ presetCompanyId, onOpenDesk, onNotice }: { presetCompanyId?: string; onOpenDesk: (company: { id: string; name: string }) => void; onNotice: Notify }) {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [map, setMap] = useState<MapData | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [query, setQuery] = useState('');
  const [registryCity, setRegistryCity] = useState('');
  const [registry, setRegistry] = useState<RegistryCompany[]>([]);
  const [searching, setSearching] = useState(false);
  const [cityText, setCityText] = useState('');
  const [cities, setCities] = useState<CitySuggestion[]>([]);
  const [city, setCity] = useState<CitySuggestion | null>(null);
  const [view, setView] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null);
  const [finished, setFinished] = useState<{ id: string; name: string; added: number } | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const busy = progress !== null;

  useEffect(() => {
    void loadOverview().then(({ companies: items }) => {
      setCompanies(items);
      const preset = items.find((item) => item.id === presetCompanyId);
      if (preset) setChosen({ id: preset.id, name: preset.name, phone: preset.phone, inn: null, ogrn: null, email: null, site: null, address: null });
    }).catch(() => onNotice('Не удалось загрузить список УК.', 'error'));
    void api<MapData>(app('/map')).then(setMap).catch(() => setMap({ buildings: [] }));
  }, [presetCompanyId]);

  // The registry of the open data, as the name or INN is typed.
  useEffect(() => {
    const words = query.trim();
    if (words.length < 2) { setRegistry([]); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api<{ items: RegistryCompany[] }>(app(`/registry/companies?${new URLSearchParams({ q: words, ...(registryCity.trim().length >= 2 ? { city: registryCity.trim() } : {}) })}`)).then(({ items }) => setRegistry(items)).catch(() => setRegistry([])).finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, registryCity]);
  useEffect(() => {
    const words = cityText.trim();
    if (words.length < 2 || city?.name === words) { setCities([]); return; }
    const timer = window.setTimeout(() => {
      void api<{ items: CitySuggestion[] }>(app(`/geo/cities?${new URLSearchParams({ q: words })}`)).then(({ items }) => setCities(items)).catch(() => setCities([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [cityText, city?.name]);

  // The map moves to the office of the chosen company: its point if it is
  // connected, otherwise the address from the registry.
  useEffect(() => {
    if (!chosen) return;
    const connected = chosen.id ? companies.find((item) => item.id === chosen.id) : null;
    if (connected?.latitude != null && connected.longitude != null) { setView({ latitude: connected.latitude, longitude: connected.longitude, zoom: 14 }); return; }
    if (!chosen.address) return;
    void api<{ item: Point }>(app(`/geo/locate?${new URLSearchParams({ q: chosen.address })}`)).then(({ item }) => setView({ ...item, zoom: 14 })).catch(() => undefined);
  }, [chosen?.id, chosen?.address, companies.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length >= 3);
  const ready = rows.filter((row) => row.status === 'ready');
  const append = (next: Row) => setRows((current) => (current.some((row) => row.key === next.key || sameHouse(row, next)) ? current : [...current, next]));
  const update = (key: string, patch: Partial<Row>) => setRows((current) => current.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...patch };
    const filled = Number(next.apartments) >= 1 && Number(next.entrances) >= 1;
    if (next.status === 'needs' && filled) next.status = 'ready';
    if (next.status === 'ready' && !filled) next.status = 'needs';
    return next;
  }));
  const unmark = (found: Row) => { setRows((current) => current.filter((row) => row.key !== found.key)); onNotice(`${[found.street, found.house].filter(Boolean).join(', ') || 'Дом'} убран из списка.`); };

  async function recogniseList() {
    if (!city) { onNotice('Сначала выберите город.', 'error'); return; }
    const todo = lines.slice(0, maxRows - rows.length);
    for (const [index, line] of todo.entries()) {
      setProgress({ done: index, total: todo.length, what: line });
      const missing = (note: string, street = ''): Row => ({ key: `line:${line}`, source: line, status: 'missing', note, street, house: '', apartments: '', entrances: '', point: null, floors: null, builtYear: null, fiasGuid: null, city: null });
      try {
        const { item } = await api<{ item: { street: string; house: string | null; latitude: number; longitude: number } }>(app(`/geo/resolve?${cityQuery(city)}&${new URLSearchParams({ q: line })}`));
        if (!item.house) { append(missing(`в городе ${city.name} есть только улица «${item.street}», такого дома нет`, item.street)); continue; }
        append(await recognise({ latitude: item.latitude, longitude: item.longitude }, line));
      } catch (failure) {
        append(missing(failure instanceof ApiError && failure.status === 404 ? `в городе ${city.name} такой адрес не найден` : 'не удалось распознать'));
      }
    }
    setProgress(null);
    setText('');
  }

  async function addPoint(point: Point) {
    if (busy) return;
    const near = rows.find((row) => row.status !== 'added' && row.point && distance(row.point, point) < 15);
    if (near) { unmark(near); return; }
    setProgress({ done: 0, total: 1, what: 'дом на карте' });
    try {
      const next = await recognise(point, 'с карты');
      const same = rows.find((row) => row.status !== 'added' && sameHouse(row, next));
      if (same) unmark(same); else append(next);
    } catch { onNotice('Не удалось распознать дом в этой точке.', 'error'); }
    setProgress(null);
  }

  async function connect() {
    if (!chosen) return;
    setProgress({ done: 0, total: ready.length, what: 'управляющая компания' });
    try {
      const id = chosen.id ?? (await api<{ item: { id: string } }>(app('/platform/companies'), { method: 'POST', body: JSON.stringify({ name: chosen.name.trim(), phone: chosen.phone.trim(), inn: chosen.inn, ogrn: chosen.ogrn, email: chosen.email, site: chosen.site, address: chosen.address }) })).item.id;
      if (!chosen.id) setChosen({ ...chosen, id });
      let added = 0;
      for (const [index, row] of ready.entries()) {
        setProgress({ done: index, total: ready.length, what: `${row.street}, ${row.house}` });
        try {
          await api(app('/company/buildings'), {
            method: 'POST',
            headers: { 'x-company-id': id },
            body: JSON.stringify({ street: row.street.trim(), house: row.house.trim(), apartmentsCount: Number(row.apartments), entrancesCount: Number(row.entrances), ...row.point!, fiasGuid: row.fiasGuid, floors: row.floors, builtYear: row.builtYear, city: row.city ?? city?.name ?? null }),
          });
          added += 1;
          update(row.key, { status: 'added', note: '' });
        } catch (failure) {
          update(row.key, { status: 'failed', note: failure instanceof ApiError && failure.code === 'building_exists' ? 'такой дом уже есть' : 'не удалось подключить' });
        }
      }
      setFinished({ id, name: chosen.name, added });
      void api<MapData>(app('/map')).then(setMap);
    } catch (failure) {
      onNotice(failure instanceof ApiError && failure.code === 'invalid_company' ? 'Проверьте название и телефон УК: нужен российский номер.' : 'Не удалось подключить УК.', 'error');
    } finally { setProgress(null); }
  }

  const pending = rows.filter((row) => row.point && row.status !== 'missing' && row.status !== 'added');

  if (finished) {
    return <section className="panel connect-done">
      <div className="panel-head"><div><h2>{finished.added} {plural(finished.added, 'дом подключён', 'дома подключены', 'домов подключено')} к «{finished.name}»</h2><p className="form-hint">У новых домов код 0000000000, у квартир 000000. Коды меняются в пульте УК, раздел «Дома».</p></div></div>
      <RowsTable rows={rows} />
      <div className="form-actions connect-actions">
        <button className="primary" type="button" onClick={() => onOpenDesk({ id: finished.id, name: finished.name })}>Открыть пульт УК</button>
        {invite ? null : <button className="filter" type="button" onClick={async () => { try { setInvite(await api<Invite>(app(`/platform/companies/${finished.id}/invites`), { method: 'POST', body: JSON.stringify({ role: 'supervisor' }) })); } catch { onNotice('Не удалось создать приглашение.', 'error'); } }}>Пригласить администратора УК</button>}
        <button className="filter" type="button" onClick={() => { setFinished(null); setRows([]); setInvite(null); }}>Подключить ещё дома</button>
      </div>
      {invite?.link ? <div className="invite-box connect-actions"><p className="form-hint">Одноразовая ссылка для администратора УК — он откроет её в MAX:</p><div className="secret-row"><input readOnly value={invite.link} onFocus={(event) => event.target.select()} /><button className="primary" type="button" onClick={() => void navigator.clipboard.writeText(invite.link!).then(() => onNotice('Ссылка скопирована.'))}>Скопировать</button></div></div> : null}
    </section>;
  }

  return <div className="connect-layout">
    <section className="panel">
      <div className="panel-head"><div><h2>1. Управляющая компания</h2><p className="form-hint">Уже подключённая УК — дома добавятся к ней. Новую найдите в открытом реестре по названию или ИНН.</p></div></div>
      <div className="status-form flat">
        {chosen ? <div className="chosen-company">
          <span><strong>{chosen.name || 'Новая УК'}</strong><small>{chosen.id ? 'уже в сервисе — дома добавятся к ней' : [chosen.inn ? `ИНН ${chosen.inn}` : null, 'будет подключена'].filter(Boolean).join(', ')}</small></span>
          <button className="filter" type="button" disabled={busy} onClick={() => { setChosen(null); setRows([]); }}>Другая УК</button>
        </div> : <div className="connect-company">
          <label>Подключённая УК<select value="" onChange={(event) => { const item = companies.find((company) => company.id === event.target.value); if (item) setChosen({ id: item.id, name: item.name, phone: item.phone, inn: null, ogrn: null, email: null, site: null, address: null }); }}>
            <option value="">Выберите из {companies.length} {plural(companies.length, 'подключённой', 'подключённых', 'подключённых')}</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name} — {company.buildingsCount} {plural(company.buildingsCount, 'дом', 'дома', 'домов')}</option>)}
          </select></label>
          <div className="form-pair">
            <label>Или новая — из реестра<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или ИНН" /></label>
            <label>Город<input type="search" value={registryCity} onChange={(event) => setRegistryCity(event.target.value)} placeholder="Любой" /><span className="field-hint">Ищется в адресе УК.</span></label>
          </div>
          {searching ? <p className="form-hint span-all">Ищем в реестре…</p> : null}
          {registry.length ? <ul className="pick-list span-all">{registry.map((item) => <li key={item.id}><button type="button" onClick={() => {
            const connected = item.connectedCompanyId ? companies.find((company) => company.id === item.connectedCompanyId) : null;
            setChosen(connected ? { id: connected.id, name: connected.name, phone: connected.phone, inn: item.inn, ogrn: item.ogrn, email: item.email, site: item.site, address: null }
              : { id: null, name: item.nameShort || item.nameFull, phone: item.phone ?? '', inn: item.inn, ogrn: item.ogrn, email: item.email, site: item.site, address: item.actualAddress || item.legalAddress });
            setQuery('');
          }}><strong>{item.nameShort || item.nameFull}</strong><small>{[item.inn ? `ИНН ${item.inn}` : null, item.housesCount ? `${item.housesCount} ${plural(item.housesCount, 'дом', 'дома', 'домов')} в управлении` : null, item.connectedCompanyId ? 'уже в сервисе' : null, item.subject].filter(Boolean).join(', ')}</small></button></li>)}</ul> : !searching && query.trim().length >= 2 ? <p className="form-hint span-all">В реестре не нашлось. Проверьте написание или ИНН — или создайте УК вручную.</p> : null}
          <div className="span-all connect-manual"><span className="form-hint">Нет ни в списке, ни в реестре?</span><button className="filter" type="button" onClick={() => setChosen({ id: null, name: query.trim(), phone: '', inn: null, ogrn: null, email: null, site: null, address: null })}>Создать УК вручную</button></div>
        </div>}
        {chosen && !chosen.id ? <div className="connect-company">
          <label>Название<input required placeholder="ООО «Управляющая компания»" value={chosen.name} onChange={(event) => setChosen({ ...chosen, name: event.target.value })} /></label>
          <label>Телефон для жителей<input type="tel" value={chosen.phone} onChange={(event) => setChosen({ ...chosen, phone: event.target.value })} placeholder="+7 (900) 000-00-00" /><span className="field-hint">Российский номер; если в реестре его нет — укажите.</span></label>
          <label className="span-all">Адрес офиса<input placeholder="г. Тюмень, ул. Газовиков, д. 69" value={chosen.address ?? ''} onChange={(event) => setChosen({ ...chosen, address: event.target.value || null })} /><span className="field-hint">Офис поставится на карту по адресу.</span></label>
        </div> : null}
      </div>
    </section>

    {chosen ? <section className="panel">
      <div className="panel-head"><div><h2>2. Дома</h2><p className="form-hint">Вставьте список домов УК по одному адресу в строке — например, с её сайта. Или нажимайте на дома на карте: повторное нажатие убирает дом из списка.</p></div></div>
      <div className="connect-grid">
        <div className="status-form flat">
          <label>Город<input value={cityText} onChange={(event) => { setCityText(event.target.value); if (city && event.target.value !== city.name) setCity(null); }} placeholder="Например, Тюмень" /></label>
          {cities.length ? <ul className="pick-list">{cities.map((item) => <li key={`${item.name}-${item.latitude}`}><button type="button" onClick={() => { setCity(item); setCityText(item.name); setCities([]); setView({ latitude: item.latitude, longitude: item.longitude, zoom: 13 }); }}><strong>{item.name}</strong><small>{item.region ?? ''}</small></button></li>)}</ul> : null}
          <label>Адреса домов<textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder={'Ленина 12\nул. Мира, д. 5, корп. 2\nпр. Победы 238'} /></label>
          <button className="primary" type="button" disabled={!lines.length || !city || busy || rows.length >= maxRows} onClick={() => void recogniseList()}>{lines.length ? `Распознать ${lines.length} ${plural(lines.length, 'адрес', 'адреса', 'адресов')}` : 'Распознать адреса'}</button>
          {!city && lines.length ? <p className="form-hint">Сначала выберите город — адреса ищутся в нём.</p> : null}
          {progress ? <div className="progress-line" role="status"><span>Распознаём {progress.done + 1} из {progress.total}: {progress.what}</span><i style={{ width: `${Math.round(((progress.done + 1) / progress.total) * 100)}%` }} /></div> : null}
        </div>
        <Suspense fallback={<div className="connect-map"><p className="form-hint">Загружаем карту…</p></div>}>
          <ConnectMap houses={map?.buildings ?? []} companyId={chosen.id} pending={pending.map((row) => row.point!)} view={view} onPick={(point) => void addPoint(point)} />
        </Suspense>
      </div>
    </section> : null}

    {rows.length ? <section className="panel">
      <div className="panel-head"><div><h2>3. Проверьте дома: {ready.length} из {rows.length} готовы</h2><p className="form-hint">Где не хватает данных, допишите квартиры и подъезды. Остальное подставлено из открытых данных.</p></div>
        <div className="panel-actions"><button className="primary" type="button" disabled={!ready.length || busy || !chosen || (!chosen.id && (chosen.name.trim().length < 2 || chosen.phone.trim().length < 6))} onClick={() => void connect()}>{chosen?.id ? `Добавить ${ready.length} ${plural(ready.length, 'дом', 'дома', 'домов')} к УК` : `Подключить УК и ${ready.length} ${plural(ready.length, 'дом', 'дома', 'домов')}`}</button></div></div>
      <RowsTable rows={rows} onChange={update} onRemove={(key) => setRows((current) => current.filter((row) => row.key !== key))} />
    </section> : null}
  </div>;
}

function RowsTable({ rows, onChange, onRemove }: { rows: Row[]; onChange?: (key: string, patch: Partial<Row>) => void; onRemove?: (key: string) => void }) {
  return <div className="table-scroll"><table className="data-table">
    <thead><tr><th>Дом</th><th>Что известно</th><th>Квартир</th><th>Подъездов</th><th>Статус</th><th /></tr></thead>
    <tbody>{rows.map((row) => {
      const editable = Boolean(onChange) && (row.status === 'ready' || row.status === 'needs');
      return <tr key={row.key}>
        <td><strong>{row.street && row.house ? `${row.street}, ${row.house}` : row.source}</strong>{row.source !== 'с карты' && row.street ? <small>из «{row.source}»</small> : row.source === 'с карты' ? <small>отмечен на карте</small> : null}</td>
        <td><small>{[row.city, row.floors ? `${row.floors} ${plural(row.floors, 'этаж', 'этажа', 'этажей')}` : null, row.builtYear ? `${row.builtYear} г.` : null, row.note].filter(Boolean).join(', ') || '—'}</small></td>
        <td>{editable ? <input className="cell-input" inputMode="numeric" value={row.apartments} onChange={(event) => onChange!(row.key, { apartments: event.target.value.replace(/\D/g, '') })} aria-label="Квартир" /> : row.apartments || '—'}</td>
        <td>{editable ? <input className="cell-input" inputMode="numeric" value={row.entrances} onChange={(event) => onChange!(row.key, { entrances: event.target.value.replace(/\D/g, '') })} aria-label="Подъездов" /> : row.entrances || '—'}</td>
        <td><span className={`badge ${statusTone[row.status]}`}>{statusText[row.status]}</span></td>
        <td className="row-actions">{onRemove && row.status !== 'added' ? <button className="filter" type="button" onClick={() => onRemove(row.key)}>Убрать</button> : null}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

// ---------- handing a house to another company ----------

export function TransferHouse({ buildingId, address, currentCompanyId, onDone, onNotice }: { buildingId: string; address: string; currentCompanyId: string; onDone: () => void; onNotice: Notify }) {
  const [companies, setCompanies] = useState<PlatformCompany[] | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  if (companies === null) return <button className="filter" type="button" onClick={() => void loadOverview().then(({ companies: items }) => setCompanies(items.filter((item) => item.id !== currentCompanyId))).catch(() => onNotice('Не удалось загрузить список УК.', 'error'))}>Передать другой УК</button>;
  return <form className="secret-row" onSubmit={async (event) => {
    event.preventDefault();
    const company = companies.find((item) => item.id === target);
    if (!company || !window.confirm(`Передать «${address}» в «${company.name}»? Дом с жителями и заявками перейдёт к ней.`)) return;
    setBusy(true);
    try { await api(app(`/platform/buildings/${buildingId}/transfer`), { method: 'POST', body: JSON.stringify({ companyId: company.id }) }); onNotice(`Дом передан в «${company.name}».`); onDone(); } catch { onNotice('Не удалось передать дом.', 'error'); } finally { setBusy(false); }
  }}>
    <select required value={target} onChange={(event) => setTarget(event.target.value)} aria-label="УК, которой передать дом"><option value="">Какой УК передать</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>
    <button className="primary" disabled={busy || !target}>Передать</button>
    <button className="filter" type="button" onClick={() => setCompanies(null)}>Отмена</button>
  </form>;
}
