import { FormEvent, useEffect, useState } from 'react';

type HealthState = 'checking' | 'online' | 'offline';
type LoadState = 'loading' | 'ready' | 'error';
type Status = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected';
type Notice = { text: string; tone: 'success' | 'error' };

type Admin = { id: string; username: string; role: string };
type Building = { id: string; address: string; apartmentsCount: number; entrancesCount: number; chatLink: string | null; _count?: { apartments: number; incidents: number } };
type EmergencyService = { id: string; name: string; phone: string; description: string };
type ApartmentAdminItem = { id: string; number: string; hasInviteCode: boolean; building: { address: string }; profile: { residentsCount: number | null; phones: string[]; people: Array<{ fullName: string; phones: string[] }> } | null; vehicles: Array<{ licensePlate: string; userId: string; owner: { fullName: string; phones: string[] } | null }>; _count: { memberships: number; reports: number } };
type ApartmentRecipient = { id: string; number: string; building: { address: string }; _count: { memberships: number } };
type Incident = {
  id: string;
  title: string;
  category: string;
  locationZone: string;
  entranceNumber: number | null;
  apartmentNumber: string | null;
  status: Status;
  priority: string;
  address: string;
  reportsCount: number;
  subscribersCount: number;
  commentsCount?: number;
  dueAt: string | null;
  delayReason: string | null;
  rejectionReason: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};
type IncidentDetail = Incident & {
  reports: Array<{ id: string; description: string; createdAt: string; apartment: { number: string } | null; author: { displayName: string | null; maxUserId: string } }>;
  events: Array<{ id: string; type: string; payload: unknown; createdAt: string }>;
  photos: Array<{ id: string; token: string; url: string | null; createdAt: string; author: { memberships: Array<{ apartment: { number: string } }> } }>;
  comments?: Array<{ id: string; text: string; createdAt: string; apartment: { number: string } | null; author: { displayName: string | null; maxUserId: string } }>;
};

const statusLabels: Record<Status, string> = {
  new: 'Новая',
  acknowledged: 'Принята',
  in_progress: 'В работе',
  resolved: 'Устранена',
  rejected: 'Отклонена',
};
const zoneLabels: Record<string, string> = {
  entrance: 'Подъезд', elevator: 'Лифт', yard: 'Двор', common: 'Другое', apartment: 'Квартира',
};

export function App() {
  const [health, setHealth] = useState<HealthState>('checking');
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<IncidentDetail | null>(null);
  const [archiveView, setArchiveView] = useState(false);
  const [incidentSort, setIncidentSort] = useState<'importance_desc' | 'importance_asc' | 'date_desc' | 'date_asc'>('importance_desc');
  const [page, setPage] = useState<'incidents' | 'buildings' | 'apartments' | 'announcements' | 'emergency-services' | 'settings'>('incidents');
  const [notice, setNotice] = useState<Notice | null>(null);

  function notify(text: string, tone: Notice['tone'] = 'success') { setNotice({ text, tone }); }
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    fetch('/health/live').then((r) => setHealth(r.ok ? 'online' : 'offline')).catch(() => setHealth('offline'));
    api<{ admin: Admin }>('/api/admin/session')
      .then(({ admin: value }) => setAdmin(value))
      .catch(() => setAdmin(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!admin || page !== 'incidents') return;
    void reloadIncidents();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reloadIncidents(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [admin, archiveView, incidentSort, page]);

  async function reloadIncidents(silent = false) {
    if (!silent) setLoadState('loading');
    try {
      const params = new URLSearchParams({ sort: incidentSort });
      if (archiveView) params.set('archive', 'true');
      const result = await api<{ items: Incident[] }>(`/api/incidents?${params}`);
      setIncidents(result.items);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }

  async function openIncident(id: string) {
    const { item } = await api<{ item: IncidentDetail }>(`/api/incidents/${id}`);
    const summary = incidents.find((incident) => incident.id === id);
    setSelected({ ...summary, ...item } as IncidentDetail);
  }

  if (!authChecked) return <CenteredMessage text="Проверяем сессию…" />;
  if (!admin) return <Login onSuccess={setAdmin} health={health} />;

  const active = incidents.filter((incident) => !['resolved', 'rejected'].includes(incident.status));
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const newToday = incidents.filter((incident) => new Date(incident.createdAt) >= start).length;
  const inProgress = incidents.filter((incident) => incident.status === 'in_progress').length;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-mark">ДП</div>
        <nav aria-label="Основная навигация"><button className={`nav-item ${page === 'incidents' ? 'active' : ''}`} onClick={() => setPage('incidents')}>Заявки</button><button className={`nav-item ${page === 'buildings' ? 'active' : ''}`} onClick={() => setPage('buildings')}>Дома</button><button className={`nav-item ${page === 'apartments' ? 'active' : ''}`} onClick={() => setPage('apartments')}>Квартиры</button><button className={`nav-item ${page === 'announcements' ? 'active' : ''}`} onClick={() => setPage('announcements')}>Сообщения</button><button className={`nav-item ${page === 'emergency-services' ? 'active' : ''}`} onClick={() => setPage('emergency-services')}>Службы</button><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>Настройки</button></nav>
      </aside>
      <main>
        <header className="topbar">
          <div><p className="eyebrow">УМНЫЙ ДОМ · ДИСПЕТЧЕРСКАЯ</p><h1>{page === 'incidents' ? 'Инциденты' : page === 'buildings' ? 'Дома' : page === 'apartments' ? 'Квартиры' : page === 'announcements' ? 'Сообщения' : page === 'emergency-services' ? 'Экстренные службы' : 'Настройки'}</h1></div>
          <div className="user-area">
            <div className={`health ${health}`}><span /> Backend: {health === 'online' ? 'доступен' : health === 'checking' ? 'проверка' : 'недоступен'}</div>
            <button className="text-button" onClick={async () => { await api('/api/admin/session', { method: 'DELETE' }); setAdmin(null); }}>Выйти · {admin.username}</button>
          </div>
        </header>
        {page === 'buildings' ? <BuildingsManager onNotice={notify} canDelete={admin.role === 'supervisor'} /> : page === 'apartments' ? <ApartmentsManager onNotice={notify} /> : page === 'announcements' ? <AnnouncementsManager onNotice={notify} /> : page === 'emergency-services' ? <EmergencyServicesManager onNotice={notify} /> : page === 'settings' ? <SettingsManager onNotice={notify} canManage={admin.role === 'supervisor'} /> : <><section className="stats" aria-label="Сводка">
          <article><strong>{archiveView ? incidents.length : active.length}</strong><span>{archiveView ? 'в архиве' : 'активных'}</span></article>
          <article><strong>{newToday}</strong><span>создано сегодня</span></article>
          <article><strong>{inProgress}</strong><span>в работе</span></article>
          <article className="accent"><strong>{incidents.reduce((sum, item) => sum + item.reportsCount, 0)}</strong><span>обращений жителей</span></article>
        </section>
        <section className="panel">
          <div className="panel-head"><div><p className="eyebrow">{archiveView ? 'АРХИВ' : 'ОЧЕРЕДЬ'}</p><h2>{archiveView ? 'Завершённые и отклонённые' : 'Требуют внимания'}</h2>{!archiveView && <p className="refresh-info">Новые заявки появляются автоматически раз в 10 секунд.</p>}</div><div className="panel-actions"><label className="incident-sort">Сортировка<select value={incidentSort} onChange={(event) => setIncidentSort(event.target.value as typeof incidentSort)}><option value="importance_desc">Важность: больше жителей</option><option value="importance_asc">Важность: меньше жителей</option><option value="date_desc">Дата: сначала новые</option><option value="date_asc">Дата: сначала старые</option></select></label><button className="filter" onClick={() => setArchiveView((value) => !value)}>{archiveView ? 'К активным' : 'Архив'}</button><button className="filter" onClick={() => void reloadIncidents()}>Обновить</button></div></div>
          <div className="incident-list">
            {loadState === 'loading' && <p className="state-message">Загружаем инциденты…</p>}
            {loadState === 'error' && <p className="state-message error">Не удалось получить данные.</p>}
            {loadState === 'ready' && incidents.length === 0 && <p className="state-message">{archiveView ? 'Архив пока пуст.' : 'Инцидентов пока нет. Создайте обращение через бота.'}</p>}
            {loadState === 'ready' && incidents.map((incident) => (
              <article className="incident" key={incident.id}>
                <div className="incident-code">#{shortId(incident.id)}<time>{formatShortDate(incident.createdAt)}</time></div>
                <div className="incident-main"><h3>{incident.title}</h3><p>{formatPlace(incident)} · {incident.address}</p></div>
                <div className="reports"><strong>{incident.reportsCount}</strong><span>жителей</span><small>{incident.commentsCount ?? 0} комм.</small></div>
                <span className={`badge ${statusTone(incident.status)}`}>{statusLabels[incident.status]}</span>
                <button className="open" onClick={() => void openIncident(incident.id)} aria-label={`Открыть ${incident.id}`}>→</button>
              </article>
            ))}
          </div>
        </section></>}
      </main>
      {selected && <IncidentDrawer incident={selected} onClose={() => setSelected(null)} onSaved={async () => { setSelected(null); await reloadIncidents(); }} onNotice={notify} />}
      {notice && <div className={`toast ${notice.tone}`} role="status"><span>{notice.tone === 'success' ? '✓' : '!'}</span><p>{notice.text}</p><button type="button" onClick={() => setNotice(null)} aria-label="Закрыть уведомление">×</button></div>}
    </div>
  );
}

function Login({ onSuccess, health }: { onSuccess: (admin: Admin) => void; health: HealthState }) {
  const [username, setUsername] = useState('dispatcher');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ admin: Admin }>('/api/admin/session', { method: 'POST', body: JSON.stringify({ username, password }) });
      onSuccess(result.admin);
    } catch { setError('Неверный логин или пароль'); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark">ДП</div><p className="eyebrow">ДИСПЕТЧЕРСКАЯ</p><h1>Вход</h1>
    <label>Логин<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
    <label>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
    {error && <p className="form-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
    <p className={`login-health ${health}`}>Backend: {health === 'online' ? 'доступен' : 'недоступен'}</p>
  </form></div>;
}

function BuildingsManager({ onNotice, canDelete }: { onNotice: (text: string, tone?: Notice['tone']) => void; canDelete: boolean }) {
  const [items, setItems] = useState<Building[]>([]);
  const [editing, setEditing] = useState<Building | null>(null);
  const [address, setAddress] = useState('');
  const [apartmentsCount, setApartmentsCount] = useState('100');
  const [entrancesCount, setEntrancesCount] = useState('1');
  const [chatLink, setChatLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { setItems((await api<{ items: Building[] }>('/api/buildings')).items); } catch { setError('Не удалось загрузить дома.'); } };
  useEffect(() => { void reload(); }, []);
  const reset = () => { setEditing(null); setAddress(''); setApartmentsCount('100'); setEntrancesCount('1'); setChatLink(''); setError(''); };
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const body = { address, apartmentsCount: Number(apartmentsCount), entrancesCount: Number(entrancesCount), chatLink: chatLink.trim() || null };
      await api(editing ? `/api/buildings/${editing.id}` : '/api/buildings', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      const message = editing ? 'Данные дома обновлены.' : 'Дом добавлен.';
      reset(); await reload(); onNotice(message);
    } catch { const message = 'Проверьте адрес и количество квартир/подъездов.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  return <div className="buildings-layout"><section className="panel buildings-panel"><div className="panel-head"><div><p className="eyebrow">ДОМА</p><h2>Добавленные дома</h2></div><button className="filter" onClick={() => void reload()}>Обновить</button></div><div className="building-list">{items.length === 0 && <p className="state-message">Дома пока не добавлены.</p>}{items.map((item) => <article className="building-row" key={item.id}><div><h3>{item.address}</h3><p>{item.apartmentsCount} квартир · {item.entrancesCount} подъездов · {item._count?.incidents ?? 0} инцидентов</p><p className="form-hint">Чат: {item.chatLink ? item.chatLink : 'ещё не создан'}</p></div><div className="building-actions"><button className="filter" onClick={() => { setEditing(item); setAddress(item.address); setApartmentsCount(String(item.apartmentsCount)); setEntrancesCount(String(item.entrancesCount)); setChatLink(item.chatLink ?? ''); setError(''); }}>Редактировать</button>{canDelete && <button className="filter danger" onClick={async () => { if (!window.confirm(`Удалить дом «${item.address}»? Все жители этого дома будут отключены и при следующем обращении к боту заполнят данные квартиры заново.`)) return; try { const result = await api<{ revokedMemberships: number }>(`/api/buildings/${item.id}`, { method: 'DELETE' }); await reload(); onNotice(result.revokedMemberships ? `Дом удалён. ${result.revokedMemberships} жителям нужно заново выбрать квартиру в боте.` : 'Дом удалён.'); } catch { const message = 'Не удалось удалить дом. Попробуйте обновить страницу и повторить действие.'; setError(message); onNotice(message, 'error'); } }}>Удалить</button>}</div></article>)}</div></section><form className="status-form building-form" onSubmit={submit}><h3>{editing ? 'Редактировать дом' : 'Добавить дом'}</h3><label>Точный адрес<input required value={address} onChange={(event) => setAddress(event.target.value)} placeholder="ул. Ленина, 10, корп. 2" /></label><label>Количество квартир<input required type="number" min="1" max="2000" value={apartmentsCount} onChange={(event) => setApartmentsCount(event.target.value)} /></label><label>Количество подъездов<input required type="number" min="1" max="50" value={entrancesCount} onChange={(event) => setEntrancesCount(event.target.value)} /></label><label>Ссылка на чат дома <input type="url" value={chatLink} onChange={(event) => setChatLink(event.target.value)} placeholder="https://max.ru/join/..." /></label><p className="form-hint">Ссылка необязательна. Если оставить поле пустым, бот сообщит жителям, что чат ещё не создан.</p>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : editing ? 'Сохранить дом' : 'Добавить дом'}</button>{editing && <button className="filter" type="button" onClick={reset}>Отмена</button>}</form></div>;
}

function ApartmentsManager({ onNotice }: { onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'apartment' | 'resident'>('apartment');
  const [withResidents, setWithResidents] = useState(false);
  const [items, setItems] = useState<ApartmentAdminItem[]>([]);
  const [selected, setSelected] = useState<ApartmentAdminItem | null>(null);
  const [number, setNumber] = useState('');
  const [residentsCount, setResidentsCount] = useState('');
  const [peopleText, setPeopleText] = useState('');
  const [vehiclesText, setVehiclesText] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [clearInviteCode, setClearInviteCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showSearching, setShowSearching] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void api<{ items: Building[] }>('/api/buildings').then(({ items: value }) => setBuildings(value)).catch(() => onNotice('Не удалось загрузить список домов.', 'error')); }, []);
  const search = async () => {
    setSearching(true); setError('');
    const delayedLabel = window.setTimeout(() => setShowSearching(true), 3000);
    try {
      const params = new URLSearchParams();
      if (buildingId) params.set('buildingId', buildingId);
      if (query.trim()) params.set('query', query.trim());
      params.set('sort', sort);
      if (withResidents) params.set('withResidents', 'true');
      const result = await api<{ items: ApartmentAdminItem[] }>(`/api/apartments?${params}`);
      setItems(result.items); setSelected(null);
    } catch { const message = 'Не удалось найти квартиры.'; setError(message); onNotice(message, 'error'); } finally { window.clearTimeout(delayedLabel); setShowSearching(false); setSearching(false); }
  };
  useEffect(() => { void search(); }, []);
  const selectApartment = (item: ApartmentAdminItem) => { setSelected(item); setNumber(item.number); setResidentsCount(item.profile?.residentsCount === null || item.profile?.residentsCount === undefined ? '' : String(item.profile.residentsCount)); setPeopleText(item.profile?.people.map((person) => `${person.fullName}${person.phones.length ? ` ${person.phones.join(' ')}` : ''}`).join('\n') ?? ''); setVehiclesText(item.vehicles.map((vehicle) => `${vehicle.licensePlate}${vehicle.owner ? ` ${vehicle.owner.fullName}${vehicle.owner.phones.length ? ` ${vehicle.owner.phones.join(' ')}` : ''}` : ''}`).join('\n')); setInviteCode(''); setClearInviteCode(false); setError(''); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError('');
    try {
      await api(`/api/apartments/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ number, residentsCount: residentsCount === '' ? null : Number(residentsCount), people: parsePeople(peopleText), vehicles: parseVehicles(vehiclesText), ...(clearInviteCode ? { inviteCode: null } : inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}) }) });
      await search(); onNotice('Данные квартиры обновлены.');
    } catch (requestError) { const message = requestError instanceof ApiError && requestError.code === 'apartment_number_taken' ? 'Такая квартира уже есть в этом доме.' : requestError instanceof ApiError && requestError.code === 'vehicle_belongs_to_another_apartment' ? 'Этот автомобиль уже привязан к другой квартире.' : requestError instanceof ApiError && requestError.code === 'apartment_has_no_residents' ? 'Нельзя добавить автомобиль: в квартире нет привязанного жителя.' : 'Не удалось сохранить данные квартиры. Проверьте формат строк.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm(`Удалить квартиру ${selected.number}? Будут удалены её привязки жителей, профиль и автомобили. Заявки останутся в истории без номера квартиры.`)) return;
    setBusy(true); setError('');
    try { await api(`/api/apartments/${selected.id}`, { method: 'DELETE' }); setSelected(null); await search(); onNotice('Квартира и её привязанные данные удалены.'); } catch { const message = 'Не удалось удалить квартиру.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  return <div className="apartments-layout"><section className="panel apartments-panel"><div className="panel-head"><div><p className="eyebrow">ПОИСК ЖИТЕЛЕЙ</p><h2>Квартиры</h2><p className="refresh-info">Выберите дом для поиска в нём или оставьте «Все дома», чтобы искать по всей базе.</p></div></div><form className="apartment-search" onSubmit={(event) => { event.preventDefault(); void search(); }}><label>Дом<select value={buildingId} onChange={(event) => setBuildingId(event.target.value)}><option value="">Все дома</option>{buildings.map((building) => <option value={building.id} key={building.id}>{building.address}</option>)}</select></label><label>Квартира или житель<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, ФИО" /></label><label>Сортировка<select value={sort} onChange={(event) => setSort(event.target.value as 'apartment' | 'resident')}><option value="apartment">По квартирам</option><option value="resident">По ФИО жильца</option></select></label><label className="checkbox-label apartment-filter"><input type="checkbox" checked={withResidents} onChange={(event) => setWithResidents(event.target.checked)} /> Только квартиры с жителями</label><button className="primary" disabled={searching}>{showSearching ? 'Ищем…' : 'Найти'}</button></form>{error && <p className="form-error apartments-error">{error}</p>}<div className="building-list apartment-list">{items.length === 0 && !searching && <p className="state-message">Ничего не найдено.</p>}{items.map((item) => <article className={`building-row apartment-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id}><button className="apartment-select" type="button" onClick={() => selectApartment(item)}><strong>Квартира {item.number}</strong><span>{item.building.address}</span><small>{item.profile?.people.length ? item.profile.people.map((person) => person.fullName).join(', ') : 'Жители не указаны'} · {item._count.memberships} привязок</small></button><button className="open" type="button" onClick={() => selectApartment(item)} aria-label={`Открыть квартиру ${item.number}`}>→</button></article>)}</div></section>{selected && <div className="overlay apartment-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><form className="drawer status-form apartment-editor" onSubmit={save}><button className="drawer-close" type="button" onClick={() => setSelected(null)}>×</button><h3>Квартира {selected.number}</h3><p className="form-hint">{selected.building.address}</p><label>Номер квартиры<input required value={number} onChange={(event) => setNumber(event.target.value)} /></label><label>Количество жильцов<input type="number" min="0" max="100" value={residentsCount} onChange={(event) => setResidentsCount(event.target.value)} placeholder="Не указано" /></label><label>Жильцы<textarea rows={6} value={peopleText} onChange={(event) => setPeopleText(event.target.value)} placeholder={'ФИО телефон\nИванов Иван +79000000000'} /></label><label>Автомобили<textarea rows={6} value={vehiclesText} onChange={(event) => setVehiclesText(event.target.value)} placeholder={'Номер владелец телефон\nА123ВС Иван +79000000000'} /></label><label>Индивидуальный код квартиры<input minLength={6} maxLength={64} value={inviteCode} disabled={clearInviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder={selected.hasInviteCode ? 'Код установлен — введите новый для замены' : 'Необязательно, от 6 символов'} /></label><label className="checkbox-label"><input type="checkbox" checked={clearInviteCode} onChange={(event) => setClearInviteCode(event.target.checked)} /> Удалить индивидуальный код</label><p className="form-hint">Код нужен вместе с кодом УК, чтобы подтвердить конкретную квартиру. Сохранённый код нельзя посмотреть — можно только заменить.</p><p className="form-hint">По одной записи на строке. Телефоны — через пробел или запятую.</p>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button><button className="filter danger" type="button" disabled={busy} onClick={() => void remove()}>Удалить квартиру</button></form></div>}</div>;
}

function AnnouncementsManager({ onNotice }: { onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [audience, setAudience] = useState<'all' | 'apartment'>('all');
  const [apartments, setApartments] = useState<ApartmentRecipient[]>([]);
  const [apartmentId, setApartmentId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { void api<{ items: ApartmentRecipient[] }>('/api/announcements/apartments').then(({ items }) => setApartments(items)).catch(() => setNotice('Не удалось загрузить список квартир.')); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const result = await api<{ recipientsCount: number }>('/api/announcements', { method: 'POST', body: JSON.stringify({ audience, ...(audience === 'apartment' ? { apartmentId } : {}), text }) });
      const message = `Сообщение поставлено в очередь для ${result.recipientsCount} получателей.`;
      setText(''); setNotice(message); onNotice(message);
    } catch { const message = 'Не удалось отправить сообщение. Выберите квартиру и проверьте текст.'; setNotice(message); onNotice(message, 'error'); }
    finally { setBusy(false); }
  }
  return <section className="panel announcements-panel"><div className="panel-head"><div><p className="eyebrow">РАССЫЛКИ</p><h2>Сообщение жителям</h2></div></div><form className="status-form announcement-form" onSubmit={submit}><label>Кому<select value={audience} onChange={(event) => setAudience(event.target.value as 'all' | 'apartment')}><option value="all">Всем подключённым жителям</option><option value="apartment">Конкретной квартире</option></select></label>{audience === 'apartment' && <label>Квартира<select required value={apartmentId} onChange={(event) => setApartmentId(event.target.value)}><option value="">Выберите квартиру</option>{apartments.map((apartment) => <option key={apartment.id} value={apartment.id}>{apartment.building.address} · квартира {apartment.number} · {apartment._count.memberships} жителей</option>)}</select></label>}<label>Текст сообщения<textarea required minLength={3} maxLength={2000} rows={6} value={text} onChange={(event) => setText(event.target.value)} placeholder="Например: Завтра с 10:00 до 14:00 будет профилактическое отключение воды." /></label><p className="form-hint">Сообщение будет отправлено в бот. Рассылка выполняется в фоне и автоматически повторяется при временной ошибке.</p>{notice && <p className={notice.startsWith('Не удалось') ? 'form-error' : 'form-hint'}>{notice}</p>}<button className="primary" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить'}</button></form></section>;
}

function SettingsManager({ onNotice, canManage }: { onNotice: (text: string, tone?: Notice['tone']) => void; canManage: boolean }) {
  const [maskedCode, setMaskedCode] = useState('••••••••••');
  const [revealedCode, setRevealedCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void api<{ maskedCode: string }>('/api/settings/uk-code').then((result) => setMaskedCode(result.maskedCode)).catch(() => onNotice('Не удалось загрузить настройки.', 'error')); }, []);
  async function reveal() {
    if (revealed) { setRevealed(false); setRevealedCode(''); return; }
    setBusy(true); setError('');
    try { const result = await api<{ code: string }>('/api/settings/uk-code?reveal=true'); setRevealedCode(result.code); setRevealed(true); } catch { const message = 'Не удалось показать код УК.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/settings/uk-code', { method: 'PATCH', body: JSON.stringify({ code: newCode }) }); setRevealed(false); setRevealedCode(''); setNewCode(''); onNotice('Код УК обновлён.'); } catch { const message = 'Код должен состоять из 10 цифр.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel"><div className="panel-head"><div><p className="eyebrow">ДОСТУП ЖИТЕЛЕЙ</p><h2>Код УК</h2></div></div>{canManage ? <form className="status-form settings-form" onSubmit={save}><label>Текущий код<div className="secret-row"><input value={revealed ? revealedCode : maskedCode} readOnly aria-label="Текущий код УК" /><button className="filter" type="button" disabled={busy} onClick={() => void reveal()}>{revealed ? 'Скрыть' : 'Показать'}</button></div></label><label>Новый код УК<input required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={newCode} onChange={(event) => setNewCode(event.target.value.replace(/\D/g, ''))} placeholder="10 цифр" /></label><p className="form-hint">Жители используют этот код при привязке к квартире. После сохранения старый код перестанет действовать.</p>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy || newCode.length !== 10}>{busy ? 'Сохраняем…' : 'Сменить код'}</button></form> : <p className="state-message">Просмотр и смена кода УК доступны только руководителю.</p>}</section>;
}

function EmergencyServicesManager({ onNotice }: { onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [items, setItems] = useState<EmergencyService[]>([]);
  const [editing, setEditing] = useState<EmergencyService | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { setItems((await api<{ items: EmergencyService[] }>('/api/emergency-services')).items); } catch { const message = 'Не удалось загрузить номера служб.'; setError(message); onNotice(message, 'error'); } };
  useEffect(() => { void reload(); }, []);
  const reset = () => { setEditing(null); setName(''); setPhone(''); setDescription(''); setError(''); };
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(editing ? `/api/emergency-services/${editing.id}` : '/api/emergency-services', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name, phone, description }) });
      const message = editing ? 'Данные службы обновлены.' : 'Контакт службы добавлен.';
      reset(); await reload(); onNotice(message);
    } catch { const message = 'Проверьте название, телефон и описание службы.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  return <div className="buildings-layout"><section className="panel buildings-panel"><div className="panel-head"><div><p className="eyebrow">КОНТАКТЫ</p><h2>Номера экстренных служб</h2></div><button className="filter" onClick={() => void reload()}>Обновить</button></div><div className="building-list">{items.length === 0 && <p className="state-message">Контакты пока не добавлены.</p>}{items.map((item) => <article className="building-row" key={item.id}><div><h3>{item.name}</h3><p className="service-phone">{item.phone}</p><p className="form-hint">{item.description}</p></div><div className="building-actions"><button className="filter" onClick={() => { setEditing(item); setName(item.name); setPhone(item.phone); setDescription(item.description); setError(''); }}>Редактировать</button><button className="filter danger" onClick={async () => { if (!window.confirm(`Удалить контакт «${item.name}»?`)) return; try { await api(`/api/emergency-services/${item.id}`, { method: 'DELETE' }); await reload(); onNotice('Контакт службы удалён.'); } catch { const message = 'Не удалось удалить контакт службы.'; setError(message); onNotice(message, 'error'); } }}>Удалить</button></div></article>)}</div></section><form className="status-form building-form" onSubmit={submit}><h3>{editing ? 'Редактировать службу' : 'Добавить службу'}</h3><label>Название службы<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Тестовая водная служба" /></label><label>Телефон<input required minLength={3} maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 (900) 000-00-00" /></label><label>Краткое описание<textarea required minLength={2} maxLength={400} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="За что отвечает служба и когда обращаться" /></label><p className="form-hint">Эти контакты увидят жители в пункте бота «Номера экстренных служб».</p>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : editing ? 'Сохранить службу' : 'Добавить службу'}</button>{editing && <button className="filter" type="button" onClick={reset}>Отмена</button>}</form></div>;
}

function IncidentDrawer({ incident, onClose, onSaved, onNotice }: { incident: IncidentDetail; onClose: () => void; onSaved: () => Promise<void>; onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [status, setStatus] = useState<Status>(incident.status);
  const [dueAt, setDueAt] = useState(incident.dueAt ? toYekaterinburgInput(incident.dueAt) : '');
  const [comment, setComment] = useState('');
  const [delayReason, setDelayReason] = useState(incident.delayReason ?? '');
  const [rejectionReason, setRejectionReason] = useState(incident.rejectionReason ?? '');
  const [withoutDueAt, setWithoutDueAt] = useState(!incident.dueAt);
  const [currentVersion, setCurrentVersion] = useState(incident.version);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    if (status === 'rejected' && rejectionReason.trim().length < 3) { setError('Укажите причину отклонения.'); setBusy(false); return; }
    const isTerminal = ['resolved', 'rejected'].includes(status);
    const plannedDueAt = withoutDueAt || isTerminal || !dueAt ? null : yekaterinburgInputToIso(dueAt);
    if (!withoutDueAt && !isTerminal && (!plannedDueAt || new Date(plannedDueAt).getTime() <= Date.now())) { setError('Плановый срок должен быть в будущем.'); setBusy(false); return; }
    try {
      await api(`/api/incidents/${incident.id}`, { method: 'PATCH', body: JSON.stringify({
        version: currentVersion,
        status,
        dueAt: plannedDueAt,
        delayReason: status === 'resolved' ? null : delayReason || null,
        rejectionReason: status === 'rejected' ? rejectionReason.trim() : null,
        publicComment: status === 'resolved' ? undefined : comment || undefined,
      }) });
      await onSaved(); onNotice('Изменения по заявке сохранены.');
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === 'incident_version_conflict') {
        try {
          const { item } = await api<{ item: IncidentDetail }>(`/api/incidents/${incident.id}`);
          setCurrentVersion(item.version);
          setStatus(item.status);
          setDueAt(item.dueAt ? toYekaterinburgInput(item.dueAt) : ''); setWithoutDueAt(!item.dueAt);
          setDelayReason(item.delayReason ?? '');
          setRejectionReason(item.rejectionReason ?? '');
          setError('Данные обновлены до актуальной версии. Выберите нужный статус и сохраните ещё раз.');
        } catch {
          setError('Инцидент изменён. Закройте карточку и откройте её снова.');
        }
      } else if (requestError instanceof ApiError && requestError.code === 'invalid_status_transition') {
        setError('Такой переход статуса недоступен. Обновите карточку и выберите следующий статус.');
      } else if (requestError instanceof ApiError && requestError.code === 'due_at_in_past') {
        setError('Плановый срок должен быть в будущем.');
      } else {
        setError('Не удалось сохранить изменения.');
      }
    } finally { setBusy(false); }
  }
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="drawer"><button className="drawer-close" onClick={onClose}>×</button>
      <p className="eyebrow">ИНЦИДЕНТ #{shortId(incident.id)}</p><h2>{incident.title}</h2><p className="drawer-meta">{incident.address} · {formatPlace(incident)}</p>
      <div className="reports-block"><h3>Обращения жителей · {incident.reports.length}</h3>{incident.reports.map((report, index) => <div className="report-card" key={report.id}><strong>{index === 0 ? 'Заявитель' : 'Присоединился'} · квартира {report.apartment?.number ?? 'не указана'}</strong><p>{report.description}</p><time>{formatFullDate(report.createdAt)}</time></div>)}</div>
      <div className="reports-block"><h3>Комментарии жителей · {incident.comments?.length ?? 0}</h3>{incident.comments?.length ? incident.comments.map((comment) => <div className="report-card" key={comment.id}><strong>Квартира {comment.apartment?.number ?? 'не указана'}</strong><p>{comment.text}</p><time>{formatFullDate(comment.createdAt)}</time><button className="filter danger comment-delete" type="button" onClick={async () => { if (!window.confirm('Удалить этот комментарий?')) return; try { await api(`/api/incidents/${incident.id}/comments/${comment.id}`, { method: 'DELETE' }); await onSaved(); onNotice('Комментарий удалён.'); } catch { const message = 'Не удалось удалить комментарий.'; setError(message); onNotice(message, 'error'); } }}>Удалить комментарий</button></div>) : <p className="form-hint">Комментариев пока нет.</p>}</div>
      <div className="reports-block"><h3>Фотографии · {incident.photos.length}</h3>{incident.photos.length === 0 ? <p className="form-hint">Фотографий пока нет.</p> : <div className="photo-grid">{incident.photos.map((photo) => photo.url ? <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Фото от квартиры ${photo.author.memberships[0]?.apartment.number ?? ''}`} /></a> : <div className="photo-token" key={photo.id}>Фото от квартиры {photo.author.memberships[0]?.apartment.number ?? 'не указана'}<small>MAX: {photo.token.slice(0, 14)}…</small></div>)}</div>}</div>
      <div className="timeline"><h3>История · {incident.events.length}</h3>{incident.events.map((event) => <div className="timeline-item" key={event.id}><strong>{eventLabel(event.type)}</strong><time>{new Date(event.createdAt).toLocaleString('ru-RU')}</time></div>)}</div>
      <form className="status-form" onSubmit={save}><h3>Обновить состояние</h3>
        <label>Статус<select value={status} onChange={(e) => { const next = e.target.value as Status; setStatus(next); if (next === 'resolved') { setDelayReason(''); setComment(''); } }}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {!['resolved', 'rejected'].includes(status) && <><label>Плановый срок<input type="datetime-local" min={toYekaterinburgInput(new Date().toISOString())} disabled={withoutDueAt} value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={withoutDueAt} onChange={(e) => setWithoutDueAt(e.target.checked)} /> Не указывать плановый срок</label></>}
        {status === 'rejected' ? <label>Причина отклонения<textarea required value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={3} placeholder="Почему заявку нельзя принять" /></label> : status !== 'resolved' && <><label>Причина переноса<input value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Если срок изменился" /></label><label>Комментарий жильцам<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Что сделано или когда ждать результат" /></label></>}
        {incident.archivedAt && <button className="filter" type="button" onClick={async () => { setBusy(true); setError(''); try { await api(`/api/incidents/${incident.id}`, { method: 'PATCH', body: JSON.stringify({ version: currentVersion, status, dueAt: ['resolved', 'rejected'].includes(status) || withoutDueAt || !dueAt ? null : yekaterinburgInputToIso(dueAt), rejectionReason: status === 'rejected' ? rejectionReason.trim() : null, archived: false }) }); await onSaved(); onNotice('Заявка восстановлена из архива.'); } catch { const message = 'Не удалось восстановить заявку.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); } }}>Восстановить из архива</button>}
        {error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить и уведомить'}</button>
      </form>
    </aside>
  </div>;
}

class ApiError extends Error {
  constructor(readonly status: number, readonly code?: string) { super(`API ${status}`); }
}
async function api<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers }, ...options });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as (T & { code?: string }) | null;
  if (!response.ok) throw new ApiError(response.status, payload?.code);
  return payload as T;
}
function parsePeople(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [fullName, phones] = splitNameAndPhones(line);
    if (!fullName) throw new Error('Invalid person');
    return { fullName, phones };
  });
}
function parseVehicles(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [licensePlate, ...ownerParts] = line.split(/\s+/);
    const [ownerName, ownerPhones] = splitNameAndPhones(ownerParts.join(' '));
    if (!licensePlate || !ownerName) throw new Error('Invalid vehicle');
    return { licensePlate, ownerName, ownerPhones };
  });
}
function splitNameAndPhones(value: string): [string, string[]] {
  const phonePattern = /(?:\+?\s*[78])(?:[\s().-]*\d){10}/g;
  const phones = value.match(phonePattern)?.map((phone) => phone.trim()) ?? [];
  const fullName = value.replace(phonePattern, ' ').replace(/\s+/g, ' ').trim();
  return [fullName, phones];
}
function shortId(id: string) { return id.slice(0, 8).toUpperCase(); }
function formatPlace(incident: Pick<Incident, 'locationZone' | 'entranceNumber' | 'apartmentNumber'>) {
  const zone = zoneLabels[incident.locationZone] ?? incident.locationZone;
  return incident.apartmentNumber ? `Квартира ${incident.apartmentNumber}` : incident.entranceNumber ? `${zone}, подъезд ${incident.entranceNumber}` : zone;
}
function statusTone(status: Status) { return ({ new: 'new', acknowledged: 'acknowledged', in_progress: 'progress', resolved: 'resolved', rejected: 'rejected' } as Record<Status, string>)[status]; }
function toYekaterinburgInput(value: string) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const item = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${item('year')}-${item('month')}-${item('day')}T${item('hour')}:${item('minute')}`;
}
function yekaterinburgInputToIso(value: string) { return new Date(`${value}:00+05:00`).toISOString(); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Yekaterinburg', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function formatFullDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Yekaterinburg', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function eventLabel(type: string) { return ({ incident_created: 'Обращение создано', resident_joined: 'Присоединился ещё один житель', incident_updated: 'Диспетчер обновил инцидент' } as Record<string, string>)[type] ?? type; }
function CenteredMessage({ text }: { text: string }) { return <div className="centered-message">{text}</div>; }
