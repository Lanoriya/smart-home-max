import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { api, ApiError, plural } from './api';
import { formatDay, formatFullDate } from './zones';

// Sections of the desk that the mini-app had and the web desk did not: the
// figures of the company, its team and invitations, the quick dial numbers,
// the map of its houses and the privacy policy of the platform.

type Notify = (text: string, tone?: 'success' | 'error') => void;
const app = (path: string) => `/api/app${path}`;
const ConnectMap = lazy(() => import('./connect-map'));

type Stats = {
  periodDays: number; incidents: number; reports: number; duplicatesAvoided: number; duplicateShare: number | null;
  open: number; newOnes: number; overdue: number; reactionMinutesMedian: number | null; resolveHoursMedian: number | null;
  onTimeShare: number | null; residents: number; buildings: number; buildingsOnMap: number;
  topCategories: Array<{ category: string; count: number }>;
};
const categoryLabels: Record<string, string> = { water: 'Водоснабжение', electricity: 'Электричество', heating: 'Отопление', elevator: 'Лифт', leak: 'Протечка', cleaning: 'Уборка', other: 'Другое' };

function duration(minutes: number | null) {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const hours = minutes / 60;
  return hours < 48 ? `${Math.round(hours)} ч` : `${Math.round(hours / 24)} дн`;
}
const percent = (share: number | null) => (share === null ? '—' : `${Math.round(share * 100)}%`);

// ---------- figures ----------

export function CompanyStats({ onNotice }: { onNotice: Notify }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { void api<{ stats: Stats }>(app('/company/overview')).then(({ stats: value }) => setStats(value)).catch(() => onNotice('Не удалось загрузить показатели.', 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!stats) return <p className="state-message">Загружаем показатели…</p>;
  const tiles: Array<[string, string, string?]> = [
    [String(stats.open), 'открыто сейчас'],
    [String(stats.newOnes), 'ждут первой реакции'],
    [String(stats.overdue), 'просрочено по плановому сроку'],
    [duration(stats.reactionMinutesMedian), 'медиана первой реакции', 'От заявки до первого ответа или смены статуса'],
    [stats.resolveHoursMedian === null ? '—' : `${Math.round(stats.resolveHoursMedian)} ч`, 'медиана решения'],
    [percent(stats.onTimeShare), 'решено в срок'],
    [String(stats.duplicatesAvoided), 'дублей не создано', 'Жители присоединились к уже открытой заявке вместо новой'],
    [String(stats.residents), plural(stats.residents, 'житель в сервисе', 'жителя в сервисе', 'жителей в сервисе')],
    [`${stats.buildingsOnMap} из ${stats.buildings}`, 'домов на карте'],
  ];
  return <>
    <section className="stat-grid" aria-label="Показатели">
      {tiles.map(([value, label, hint]) => <article key={label} title={hint}><strong>{value}</strong><span>{label}</span></article>)}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Частые проблемы за {stats.periodDays} {plural(stats.periodDays, 'день', 'дня', 'дней')}</h2><p className="form-hint">Всего заявок: {stats.incidents}, обращений жителей: {stats.reports}.</p></div></div>
      {stats.topCategories.length ? <div className="table-scroll"><table className="data-table"><tbody>{stats.topCategories.map((item) => <tr key={item.category}><td>{categoryLabels[item.category] ?? item.category}</td><td className="row-actions">{item.count}</td></tr>)}</tbody></table></div> : <p className="state-message">Заявок за этот период не было.</p>}
    </section>
  </>;
}

// ---------- team ----------

type Member = { id: string; role: string; displayName: string | null; username: string; viaMax: boolean; createdAt: string };
type Invite = { link: string | null; expiresAt: string };

export function TeamManager({ isPlatform, onLeft, onNotice }: { isPlatform: boolean; onLeft: () => void; onNotice: Notify }) {
  const [items, setItems] = useState<Member[] | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  useEffect(() => { void api<{ items: Member[] }>(app('/company/team')).then(({ items: value }) => setItems(value)).catch(() => setItems([])); }, []);
  const create = async () => {
    try { setInvite(await api<Invite>(app('/company/invites'), { method: 'POST', body: JSON.stringify({ role: 'supervisor' }) })); } catch { onNotice('Не удалось создать приглашение.', 'error'); }
  };
  const leave = async () => {
    if (!window.confirm('Выйти из сотрудников УК? Доступ к пульту пропадёт сразу. Вернуться можно только по новому приглашению.')) return;
    try { await api(app('/company/leave'), { method: 'POST' }); onNotice('Вы больше не сотрудник УК.'); onLeft(); } catch { onNotice('Не удалось выйти из сотрудников.', 'error'); }
  };
  return <section className="panel">
    <div className="panel-head"><div><h2>Сотрудники УК</h2><p className="form-hint">Сотрудник открывает ссылку-приглашение в MAX и получает пульт: в приложении и здесь, по кнопке «Веб-диспетчерская» в боте.</p></div>
      <div className="panel-actions"><button className="primary" type="button" onClick={() => void create()}>Пригласить сотрудника</button></div></div>
    {invite ? <div className="invite-box connect-actions">{invite.link ? <><p className="form-hint">Одноразовая ссылка, действует до {formatFullDate(invite.expiresAt)}. Отправьте её сотруднику — он откроет её в MAX.</p><div className="secret-row"><input readOnly value={invite.link} onFocus={(event) => event.target.select()} /><button className="primary" type="button" onClick={() => void navigator.clipboard.writeText(invite.link!).then(() => onNotice('Ссылка скопирована.'))}>Скопировать</button></div></> : <p className="form-error">Ссылка не собралась: у бота не задано имя.</p>}</div> : null}
    {items === null ? <p className="state-message">Загружаем…</p> : items.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Сотрудник</th><th>Вход</th><th>С какого времени</th></tr></thead>
      <tbody>{items.map((member) => <tr key={member.id}><td><strong>{member.displayName ?? member.username}</strong></td><td>{member.viaMax ? 'через MAX' : 'по паролю'}</td><td>{formatDay(member.createdAt)}</td></tr>)}</tbody>
    </table></div> : <p className="state-message">Сотрудников пока нет.</p>}
    {isPlatform ? null : <div className="connect-actions"><button className="filter danger" type="button" onClick={() => void leave()}>Выйти из сотрудников УК</button></div>}
  </section>;
}

// ---------- quick dial ----------

type Dial = { number: string; title: string };

export function QuickDialManager({ onNotice }: { onNotice: Notify }) {
  const [items, setItems] = useState<Dial[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ quickDial: Dial[]; customQuickDial: boolean }>(app('/company/services')).then((data) => { setItems(data.quickDial); setCustom(data.customQuickDial); });
  useEffect(() => { void load().catch(() => onNotice('Не удалось загрузить быстрый набор.', 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return null;
  const change = (index: number, patch: Partial<Dial>) => setItems((current) => current!.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const save = async (next: Dial[] | null) => {
    setBusy(true);
    try { await api(app('/company/quick-dial'), { method: 'PUT', body: JSON.stringify({ items: next }) }); await load(); onNotice(next ? 'Быстрый набор сохранён.' : 'Вернули стандартные номера.'); }
    catch { onNotice('Проверьте номера: только цифры, название не короче двух букв.', 'error'); } finally { setBusy(false); }
  };
  return <section className="panel quick-dial-panel">
    <div className="panel-head"><div><h2>Быстрый набор</h2><p className="form-hint">{custom ? 'Жители видят список вашей УК.' : 'Сейчас жители видят стандартные номера: они работают с любого телефона.'} Номера показываются в приложении во вкладке «Службы» и в боте.</p></div>
      <div className="panel-actions">{custom ? <button className="filter" type="button" disabled={busy} onClick={() => void save(null)}>Вернуть стандартные</button> : null}<button className="primary" type="button" disabled={busy || !items.length} onClick={() => void save(items.map((item) => ({ number: item.number.trim(), title: item.title.trim() })))}>Сохранить</button></div></div>
    <div className="dial-rows">
      {items.map((item, index) => <div className="dial-row" key={index}>
        <input inputMode="tel" value={item.number} onChange={(event) => change(index, { number: event.target.value })} aria-label="Номер" placeholder="112" />
        <input value={item.title} onChange={(event) => change(index, { title: event.target.value })} aria-label="Название" placeholder="Название" />
        <button className="filter danger small" type="button" onClick={() => setItems((current) => current!.filter((_, at) => at !== index))}>Убрать</button>
      </div>)}
      {items.length < 8 ? <button className="filter" type="button" onClick={() => setItems((current) => [...current!, { number: '', title: '' }])}>Добавить номер</button> : null}
    </div>
  </section>;
}

// ---------- the houses on a map ----------

export function HousesMap({ houses, companyId }: { houses: Array<{ id: string; address: string; latitude: number | null; longitude: number | null }>; companyId: string }) {
  if (!houses.some((house) => house.latitude !== null)) return null;
  return <section className="panel houses-map">
    <Suspense fallback={<p className="state-message">Загружаем карту…</p>}>
      <ConnectMap houses={houses.map((house) => ({ ...house, companyId }))} companyId={companyId} pending={[]} view={null} />
    </Suspense>
  </section>;
}

// ---------- privacy policy (platform) ----------

type Privacy = { title: string; intro: string; sections: Array<{ title: string; text: string }> };

export function PrivacyManager({ onNotice }: { onNotice: Notify }) {
  const [value, setValue] = useState<Privacy | null>(null);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ item: Privacy; custom: boolean }>(app('/platform/privacy')).then((data) => { setValue(data.item); setCustom(data.custom); }).catch(() => onNotice('Не удалось загрузить политику.', 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!value) return <p className="state-message">Загружаем…</p>;
  const save = async (next: Privacy | null, event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    try {
      const data = await api<{ item: Privacy; custom: boolean }>(app('/platform/privacy'), { method: 'PUT', body: JSON.stringify({ item: next }) });
      setValue(data.item); setCustom(data.custom);
      onNotice(next ? 'Политика сохранена. Жители видят её в приложении и по ссылке из бота.' : 'Вернули исходный текст.');
    } catch (failure) { onNotice(failure instanceof ApiError && failure.code === 'invalid_privacy' ? 'Проверьте: у политики нужен заголовок, у каждого раздела — название и текст.' : 'Не удалось сохранить политику.', 'error'); } finally { setBusy(false); }
  };
  const change = (index: number, patch: Partial<Privacy['sections'][number]>) => setValue((current) => current && { ...current, sections: current.sections.map((section, at) => (at === index ? { ...section, ...patch } : section)) });
  return <form className="panel" onSubmit={(event) => void save(value, event)}>
    <div className="panel-head"><div><h2>Политика обработки персональных данных</h2><p className="form-hint">Жители читают её в приложении перед согласием и в «Ещё», в боте — по ссылке. Абзацы и пункты — с новой строки.</p></div>
      <div className="panel-actions">{custom ? <button className="filter" type="button" disabled={busy} onClick={() => { if (window.confirm('Вернуть исходный текст политики? Правки удалятся.')) void save(null); }}>Вернуть исходный текст</button> : null}<a className="filter" href="/api/privacy/page" target="_blank" rel="noreferrer">Открыть страницу</a><button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></div></div>
    <div className="status-form flat">
      <label>Заголовок<input required maxLength={200} value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} /></label>
      <label>Вступление<textarea rows={4} maxLength={3000} value={value.intro} onChange={(event) => setValue({ ...value, intro: event.target.value })} /></label>
    </div>
    <div className="duties-grid">
      {value.sections.map((section, index) => <div className="status-form duty-block" key={index}>
        <div className="duty-head"><strong>Раздел {index + 1}</strong><button className="filter danger small" type="button" onClick={() => setValue({ ...value, sections: value.sections.filter((_, at) => at !== index) })}>Убрать</button></div>
        <label>Название<input required maxLength={200} value={section.title} onChange={(event) => change(index, { title: event.target.value })} /></label>
        <label>Текст<textarea required rows={Math.min(14, Math.max(4, section.text.split('\n').length + 1))} maxLength={5000} value={section.text} onChange={(event) => change(index, { text: event.target.value })} /></label>
      </div>)}
      {value.sections.length < 30 ? <button className="filter duty-add" type="button" onClick={() => setValue({ ...value, sections: [...value.sections, { title: '', text: '' }] })}>Добавить раздел</button> : null}
    </div>
  </form>;
}
