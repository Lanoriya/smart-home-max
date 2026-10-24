import { FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { actAsCompany, api, ApiError, plural } from './api';
import { DutiesManager } from './duties';
import { AppointmentsManager, PollsManager } from './engagement';
import { CompanyStats, HousesMap, PrivacyManager, QuickDialManager, TeamManager } from './desk-extra';
import { loadOverview, PlatformConnect, PlatformOverview, TransferHouse, type PlatformCompany } from './platform';
import { formatFullDate, formatShortDate, setDeskZone, toZoneInput, zoneInputToIso, zoneOffset } from './zones';
import { HouseQrButton, PhoneIncidentDrawer } from './intake';

type HealthState = 'checking' | 'online' | 'offline';
type LoadState = 'loading' | 'ready' | 'error';
type Status = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected';
type Notice = { text: string; tone: 'success' | 'error' };

type Admin = { id: string; username: string; role: string; company?: { id: string; name: string } | null };
type Building = { id: string; address: string; street: string; house: string; companyId?: string; latitude?: number | null; longitude?: number | null; apartmentsCount: number; entrancesCount: number; chatLink: string | null; _count?: { apartments: number; incidents: number } };
type EmergencyService = { id: string; name: string; phone: string; description: string };
type ConnectedResident = { verifiedAt: string; user: { displayName: string | null; maxUsername: string | null; sharedPhone: string | null } };
type ApartmentAdminItem = { id: string; number: string; contractNumber?: string; hasInviteCode: boolean; memberships?: ConnectedResident[]; building: { address: string }; profile: { residentsCount: number | null; phones: string[]; people: Array<{ fullName: string; phones: string[] }> } | null; vehicles: Array<{ licensePlate: string; userId: string; owner: { fullName: string; phones: string[] } | null }>; _count: { memberships: number; reports: number } };
type ApartmentRecipient = { id: string; number: string; building: { id: string; address: string }; _count: { memberships: number } };
type Incident = {
  id: string;
  number: number;
  title: string;
  category: string;
  locationZone: string;
  entranceNumber: number | null;
  apartmentNumber: string | null;
  status: Status;
  priority: string;
  // A resident in MAX or a phone call registered by the dispatcher.
  source?: 'resident' | 'phone';
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
  // The time zone of the house: the dates of the incident are on its clock.
  timeZone: string;
  // The longest term the law gives the company for this incident.
  legalTerm?: { title: string; dueAt: string; firstStep: string | null; source: string };
};
type IncidentDetail = Incident & {
  reports: Array<{ id: string; description: string; createdAt: string; apartment: { number: string } | null; author: { displayName: string | null; maxUserId: string } }>;
  events: Array<{ id: string; type: string; payload: unknown; createdAt: string }>;
  photos: Array<{ id: string; token: string; url: string | null; createdAt: string; author: { memberships: Array<{ apartment: { number: string } }> } }>;
  comments?: Array<{ id: string; text: string; createdAt: string; apartment: { number: string } | null; author: { displayName: string | null; maxUserId: string } }>;
  building?: { address: string };
  callerName?: string | null; callerPhone?: string | null; callNote?: string | null;
  // Answers of residents after "resolved": confirmed (with a rating) or returned.
  feedback?: Array<{ id: string; resolved: boolean; rating: number | null; comment: string | null; updatedAt: string; apartment: { number: string } | null }>;
  feedbackSummary?: { confirmed: number; returned: number; ratingAverage: number | null };
};

const statusLabels: Record<Status, string> = {
  new: 'Новая',
  acknowledged: 'Принята',
  in_progress: 'В работе',
  resolved: 'Устранена',
  rejected: 'Отклонена',
};
type Page = 'platform' | 'platform-connect' | 'platform-duties' | 'platform-privacy' | 'duties' | 'stats' | 'team' | 'polls' | 'appointments' | 'account' | 'incidents' | 'buildings' | 'apartments' | 'announcements' | 'emergency-services' | 'settings' | 'help';

// One place for page names: the sidebar, the page title and the help page use
// the same words, so a dispatcher meets each section under one name.
const pages: Array<{ id: Page; title: string; nav: string; hint: string; intro: string }> = [
  { id: 'platform', title: 'Управляющие компании', nav: 'Все УК', hint: 'показатели и карточки', intro: 'Все подключённые управляющие компании рядом: дома, жители, открытые заявки и скорость ответа. Откройте пульт любой УК, чтобы работать как её сотрудник.' },
  { id: 'platform-connect', title: 'Подключение', nav: 'Подключение', hint: 'УК и её дома', intro: 'Новая управляющая компания из открытого реестра и все её дома разом — списком адресов или нажатиями на карте.' },
  { id: 'incidents', title: 'Заявки жителей', nav: 'Заявки', hint: 'очередь и архив', intro: 'Обращения из бота, объединённые по одной проблеме. Откройте заявку, чтобы сменить статус, назначить срок и написать жителям.' },
  { id: 'buildings', title: 'Дома', nav: 'Дома', hint: 'адреса и коды', intro: 'Подключённые дома, их подъезды и квартиры. Здесь же руководитель выдаёт и меняет код дома для жителей.' },
  { id: 'apartments', title: 'Квартиры и жители', nav: 'Квартиры', hint: 'поиск жителей', intro: 'Поиск квартиры по номеру или ФИО жильца. Можно поправить данные квартиры и задать ей индивидуальный код.' },
  { id: 'announcements', title: 'Объявления', nav: 'Объявления', hint: 'рассылки в бот', intro: 'Сообщения жителям в бот: всем, одному дому или одной квартире. Отправленные объявления хранятся в архиве бота.' },
  { id: 'emergency-services', title: 'Экстренные службы', nav: 'Службы', hint: 'аварийные телефоны', intro: 'Телефоны аварийных и обслуживающих служб. Жители видят их в разделе бота «Номера экстренных служб».' },
  { id: 'settings', title: 'Профиль УК', nav: 'Профиль УК', hint: 'название и контакты', intro: 'Название управляющей компании и контакты для жителей.' },
  { id: 'account', title: 'Учётная запись', nav: 'Учётная запись', hint: 'логин и пароль', intro: 'Вход на сайт по логину и паролю — вдобавок ко входу из MAX. Пароль хранится только в виде хеша.' },
  { id: 'polls', title: 'Опросы жителей', nav: 'Опросы', hint: 'голосования с таймером', intro: 'Вопрос жителям всех домов или одного дома: до 15 вариантов, анонимно или открыто, с окончанием по времени.' },
  { id: 'appointments', title: 'Приём граждан', nav: 'Приём граждан', hint: 'запись жителей', intro: 'Окна приёма, на которые жители записываются в приложении, и кто на какое время записан.' },
  { id: 'stats', title: 'Показатели УК', nav: 'Показатели', hint: 'скорость и сроки', intro: 'Как быстро УК отвечает и решает заявки, сколько повторных обращений объединилось и что чаще всего ломается.' },
  { id: 'team', title: 'Команда', nav: 'Команда', hint: 'сотрудники и приглашения', intro: 'Сотрудники УК, у которых есть пульт, и приглашение нового сотрудника.' },
  { id: 'platform-privacy', title: 'Персональные данные', nav: 'Политика данных', hint: 'текст для жителей', intro: 'Политика обработки персональных данных: жители читают её перед согласием в приложении и по ссылке из бота.' },
  { id: 'duties', title: 'Обязанности УК', nav: 'Обязанности УК', hint: 'законы и сроки', intro: 'Что УК должна делать по закону и в какие сроки. Жители видят этот текст в приложении и в боте.' },
  { id: 'platform-duties', title: 'Обязанности УК', nav: 'Обязанности УК', hint: 'общий текст', intro: 'Общий текст обязанностей и сроков по законам — для всех УК, у которых нет своей версии.' },
  { id: 'help', title: 'Справка', nav: 'Справка', hint: 'как всё устроено', intro: 'Что есть в каждом разделе диспетчерской, как жители подключаются к боту и что они видят.' },
];

const zoneLabels: Record<string, string> = {
  entrance: 'Подъезд', elevator: 'Лифт', yard: 'Двор', common: 'Другое', apartment: 'Квартира',
};

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    // Remembered per browser; without a stored choice the system theme is used.
    try { window.localStorage.setItem('theme', next); } catch { /* storage may be unavailable */ }
  };
  const [health, setHealth] = useState<HealthState>('checking');
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<IncidentDetail | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [saved] = useState(readFilters);
  const [archiveView, setArchiveView] = useState(saved.archiveView ?? false);
  const [placeFilter, setPlaceFilter] = useState(saved.placeFilter ?? '');
  const [categoryFilter, setCategoryFilter] = useState(saved.categoryFilter ?? '');
  const [zoneFilter, setZoneFilter] = useState(saved.zoneFilter ?? '');
  const [statusFilter, setStatusFilter] = useState(saved.statusFilter ?? '');
  const [priorityFilter, setPriorityFilter] = useState(saved.priorityFilter ?? '');
  const [navOpen, setNavOpen] = useState(false);
  // Open emergencies, shown above the queue whatever the filters are.
  const [emergencies, setEmergencies] = useState<Incident[]>([]);
  const [numberInput, setNumberInput] = useState('');
  const [numberFilter, setNumberFilter] = useState('');
  const [allBuildings, setAllBuildings] = useState<Building[]>([]);
  const [incidentSort, setIncidentSort] = useState<'urgency_desc' | 'importance_desc' | 'importance_asc' | 'date_desc' | 'date_asc' | 'updated_desc' | 'due_asc' | 'category' | 'zone' | 'address'>(saved.incidentSort ?? 'urgency_desc');
  const [page, setPage] = useState<Page>('incidents');
  // A platform administrator works with the whole platform or acts for one
  // company: then the desk shows that company, as its staff sees it.
  const [acting, setActing] = useState<{ id: string; name: string } | null>(null);
  const [connectPreset, setConnectPreset] = useState<string | undefined>(undefined);
  const [companyList, setCompanyList] = useState<PlatformCompany[]>([]);
  const isPlatform = admin?.role === 'platform_admin';
  const platformMode = isPlatform && !acting;
  const openDesk = (company: { id: string; name: string } | null) => {
    actAsCompany(company?.id ?? null);
    setActing(company);
    setSelected(null);
    setIncidents([]);
    setEmergencies([]);
    setAllBuildings([]);
    setPlaceFilter('');
    setConnectPreset(undefined);
    setPage(company ? 'incidents' : 'platform');
    try { if (company) window.sessionStorage.setItem('acting', JSON.stringify(company)); else window.sessionStorage.removeItem('acting'); } catch { /* storage may be unavailable */ }
  };
  // The clock of the company the desk works for; it changes with the company.
  const [, setZoneLoaded] = useState(0);
  useEffect(() => {
    if (!admin) return;
    void api<{ timeZone: string | null }>('/api/admin/session').then(({ timeZone }) => { setDeskZone(timeZone); setZoneLoaded((value) => value + 1); }).catch(() => undefined);
  }, [admin, acting]);
  useEffect(() => {
    if (!isPlatform) return;
    void loadOverview().then(({ companies }) => setCompanyList(companies)).catch(() => setCompanyList([]));
  }, [isPlatform, acting, page]);
  const [notice, setNotice] = useState<Notice | null>(null);

  function notify(text: string, tone: Notice['tone'] = 'success') { setNotice({ text, tone }); }
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    fetch('/health/live').then((r) => setHealth(r.ok ? 'online' : 'offline')).catch(() => setHealth('offline'));
    // Opened by the one-time link from the mini-app in MAX: sign in with it and
    // take the token out of the address bar right away.
    const loginToken = new URLSearchParams(window.location.search).get('login');
    if (loginToken) window.history.replaceState(null, '', window.location.pathname);
    const session = loginToken
      ? api<{ admin: Admin }>('/api/admin/session/link', { method: 'POST', body: JSON.stringify({ token: loginToken }) })
        .catch(() => { setNotice({ text: 'Ссылка для входа устарела. Откройте веб-пульт из приложения в MAX ещё раз.', tone: 'error' }); return api<{ admin: Admin }>('/api/admin/session'); })
      : api<{ admin: Admin }>('/api/admin/session');
    session
      .then(({ admin: value }) => {
        // The company a platform administrator acted for stays chosen after a reload.
        if (value.role === 'platform_admin') {
          const stored = readActing();
          actAsCompany(stored?.id ?? null);
          setActing(stored);
          if (!stored) setPage('platform');
        }
        setAdmin(value);
      })
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
  }, [admin, acting, archiveView, incidentSort, page, placeFilter, numberFilter, categoryFilter, zoneFilter, statusFilter, priorityFilter]);

  // A status of the queue does not exist in the archive and the other way round.
  const shownArchive = useRef(archiveView);
  useEffect(() => {
    if (shownArchive.current !== archiveView) setStatusFilter('');
    shownArchive.current = archiveView;
  }, [archiveView]);
  useEffect(() => {
    try { window.localStorage.setItem('desk-filters', JSON.stringify({ archiveView, placeFilter, categoryFilter, zoneFilter, statusFilter, priorityFilter, incidentSort })); } catch { /* storage may be unavailable */ }
  }, [archiveView, placeFilter, categoryFilter, zoneFilter, statusFilter, priorityFilter, incidentSort]);

  useEffect(() => {
    if (!admin || page !== 'incidents') return;
    void api<{ items: Building[] }>('/api/buildings').then(({ items }) => setAllBuildings(items)).catch(() => setAllBuildings([]));
  }, [admin, acting, page]);

  async function reloadIncidents(silent = false) {
    if (!silent) setLoadState('loading');
    try {
      const params = new URLSearchParams({ sort: incidentSort });
      if (archiveView) params.set('archive', 'true');
      if (numberFilter) params.set('number', numberFilter);
      else if (placeFilter.startsWith('street:')) params.set('street', placeFilter.slice('street:'.length));
      else if (placeFilter.startsWith('building:')) params.set('buildingId', placeFilter.slice('building:'.length));
      if (!numberFilter) {
        if (categoryFilter) params.set('category', categoryFilter);
        if (zoneFilter) params.set('zone', zoneFilter);
        if (statusFilter) params.set('status', statusFilter);
        if (priorityFilter) params.set('priority', priorityFilter);
      }
      const [result, urgent] = await Promise.all([
        api<{ items: Incident[] }>(`/api/incidents?${params}`),
        api<{ items: Incident[] }>('/api/incidents?priority=emergency&sort=date_desc'),
      ]);
      setIncidents(result.items);
      setEmergencies(urgent.items);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }

  async function openIncident(id: string) {
    const { item } = await api<{ item: IncidentDetail }>(`/api/incidents/${id}`);
    const summary = incidents.find((incident) => incident.id === id);
    // A just created incident is not in the loaded queue yet.
    setSelected({ ...summary, ...item, address: summary?.address ?? item.building?.address ?? '' } as IncidentDetail);
  }

  if (!authChecked) return <CenteredMessage text="Проверяем сессию…" />;
  if (!admin) return <Login onSuccess={(value) => { if (value.role === 'platform_admin') setPage('platform'); setAdmin(value); }} health={health} theme={theme} onToggleTheme={toggleTheme} />;

  // The platform: its own sections, the queue of all companies and help. A
  // company (own or chosen by the platform): the desk sections.
  const visiblePages = pages.filter((item) => (platformMode
    ? ['platform', 'platform-connect', 'platform-duties', 'platform-privacy', 'account', 'help'].includes(item.id)
    : !item.id.startsWith('platform') && item.id !== 'account'));
  const currentPage = visiblePages.find((item) => item.id === page) ?? visiblePages[0]!;
  const active = incidents.filter((incident) => !['resolved', 'rejected'].includes(incident.status));
  // "Today" of each house, on its own clock.
  const nowIso = new Date().toISOString();
  const newToday = incidents.filter((incident) => toZoneInput(incident.createdAt, incident.timeZone).slice(0, 10) === toZoneInput(nowIso, incident.timeZone).slice(0, 10)).length;
  const inProgress = incidents.filter((incident) => incident.status === 'in_progress').length;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand subtitle={platformMode ? 'Администрирование платформы' : acting?.name ?? admin.company?.name ?? 'Диспетчерская УК'} />
        {isPlatform ? (
          <label className="company-switch">
            <span>Работаю как</span>
            <select value={acting?.id ?? ''} onChange={(event) => { const company = companyList.find((item) => item.id === event.target.value); openDesk(company ? { id: company.id, name: company.name } : null); }}>
              <option value="">Администратор платформы</option>
              {companyList.map((company) => <option key={company.id} value={company.id}>Пульт: {company.name}</option>)}
            </select>
          </label>
        ) : null}
        {/* On a narrow screen the sections fold into a menu instead of a strip to scroll. */}
        <button type="button" className="nav-toggle" aria-expanded={navOpen} aria-controls="desk-nav" onClick={() => setNavOpen((value) => !value)}>
          <span className="nav-toggle-icon" aria-hidden="true"><i /><i /><i /></span>{currentPage.nav}
        </button>
        <nav id="desk-nav" className={navOpen ? 'open' : ''} aria-label="Разделы диспетчерской">{visiblePages.map((item) => <Fragment key={item.id}>{(item.id === 'help' || item.id === 'account') && <div className="nav-separator" />}<button className={`nav-item ${currentPage.id === item.id ? 'active' : ''}`} aria-current={currentPage.id === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setNavOpen(false); }}>{item.nav}<small>{item.hint}</small></button></Fragment>)}</nav>
        <p className="sidebar-foot">Вы вошли как {admin.username}, {admin.role === 'platform_admin' ? 'администратор платформы' : 'администратор УК'}.</p>
      </aside>
      <main>
        <header className="topbar">
          <div><h1>{currentPage.title}</h1><p className="page-intro">{platformMode && currentPage.id === 'incidents' ? 'Заявки жителей всех управляющих компаний. Чтобы ответить от имени УК, откройте её пульт.' : currentPage.intro}</p></div>
          <div className="user-area">
            <div className={`health ${health}`} title="Связь диспетчерской с сервером. Если связи нет, изменения не сохранятся."><span /> {health === 'online' ? 'Сервер на связи' : health === 'checking' ? 'Проверяем связь…' : 'Нет связи с сервером'}</div>
            <button className="text-button theme-toggle" type="button" onClick={toggleTheme} aria-pressed={theme === 'dark'} title="Переключить светлую и тёмную тему">{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button>
            <button className="text-button" onClick={async () => { await api('/api/admin/session', { method: 'DELETE' }); setAdmin(null); }}>Выйти</button>
          </div>
        </header>
        {acting ? <div className="acting-bar" role="status"><span>Вы в пульте «{acting.name}» как администратор платформы. Всё, что вы делаете здесь, делается от имени этой УК.</span><button className="filter" type="button" onClick={() => openDesk(null)}>Вернуться к платформе</button></div> : null}
        {currentPage.id === 'platform' ? <PlatformOverview onOpenDesk={openDesk} onConnect={(companyId) => { setConnectPreset(companyId); setPage('platform-connect'); }} onNotice={notify} />
          : currentPage.id === 'platform-duties' ? <DutiesManager scope="platform" onNotice={notify} />
          : currentPage.id === 'platform-privacy' ? <PrivacyManager onNotice={notify} />
          : currentPage.id === 'polls' ? <PollsManager key={acting?.id ?? 'own'} onNotice={notify} />
          : currentPage.id === 'appointments' ? <AppointmentsManager key={acting?.id ?? 'own'} onNotice={notify} />
          : currentPage.id === 'stats' ? <CompanyStats key={acting?.id ?? 'own'} onNotice={notify} />
          : currentPage.id === 'team' ? <TeamManager key={acting?.id ?? 'own'} isPlatform={isPlatform} onLeft={() => setAdmin(null)} onNotice={notify} />
          : currentPage.id === 'duties' ? <DutiesManager key={acting?.id ?? 'own'} scope="company" onNotice={notify} />
          : currentPage.id === 'account' ? <AccountSettings admin={admin} onSaved={setAdmin} onNotice={notify} />
          : currentPage.id === 'platform-connect' ? <PlatformConnect key={connectPreset ?? 'new'} {...(connectPreset ? { presetCompanyId: connectPreset } : {})} onOpenDesk={openDesk} onNotice={notify} />
          : currentPage.id === 'buildings' ? <BuildingsManager key={acting?.id ?? 'own'} onNotice={notify} canDelete={admin.role !== 'dispatcher'} transferFrom={isPlatform ? acting?.id ?? null : null} /> : currentPage.id === 'apartments' ? <><JoinRequestsPanel key={`join-${acting?.id ?? 'own'}`} onNotice={notify} /><ApartmentsManager key={acting?.id ?? 'own'} onNotice={notify} /></> : currentPage.id === 'announcements' ? <AnnouncementsManager key={acting?.id ?? 'own'} onNotice={notify} /> : currentPage.id === 'emergency-services' ? <><QuickDialManager key={`dial-${acting?.id ?? 'own'}`} onNotice={notify} /><EmergencyServicesManager key={acting?.id ?? 'own'} onNotice={notify} /></> : currentPage.id === 'settings' ? <UkContactsManager key={acting?.id ?? 'own'} onNotice={notify} onSaved={(name) => { if (acting) setActing({ ...acting, name }); else setAdmin((current) => (current ? { ...current, company: { id: current.company?.id ?? '', name } } : current)); }} /> : currentPage.id === 'help' ? <HelpPage onOpen={setPage} /> : <><section className="stats" aria-label="Сводка">
          <article title="Заявки без статуса «Устранена» или «Отклонена»"><strong>{archiveView ? incidents.length : active.length}</strong><span>{archiveView ? 'в архиве' : 'ждут решения'}</span></article>
          <article title="По местному времени каждого дома"><strong>{newToday}</strong><span>поступило сегодня</span></article>
          <article><strong>{inProgress}</strong><span>в работе</span></article>
          <article className="accent" title="Сколько жителей обратились по этим заявкам, включая присоединившихся"><strong>{incidents.reduce((sum, item) => sum + item.reportsCount, 0)}</strong><span>жителей обратились</span></article>
        </section>
        {!archiveView && emergencies.length ? (
          <section className="emergency-panel" aria-label="Аварии">
            <div><strong>Аварии: {emergencies.length}</strong><span>нужно немедленное вмешательство</span></div>
            <ul>{emergencies.slice(0, 4).map((incident) => <li key={incident.id}><button type="button" onClick={() => void openIncident(incident.id)}>№ {incident.number}. {incident.title} — {incident.address}</button></li>)}</ul>
            {priorityFilter === 'emergency'
              ? <button type="button" className="filter" onClick={() => setPriorityFilter('')}>Вернуть все заявки</button>
              : <button type="button" className="filter" onClick={() => setPriorityFilter('emergency')}>Показать только аварии</button>}
          </section>
        ) : null}
        <section className="panel">
          <div className="queue-head">
            <div className="queue-title"><div><h2>{archiveView ? 'Архив: устранённые и отклонённые' : 'Очередь заявок'}</h2><p className="refresh-info">{archiveView ? 'Заявку из архива можно открыть и вернуть в работу.' : 'Список обновляется сам каждые 10 секунд. Чем больше жителей поддержали заявку, тем она выше.'}</p></div>
              <div className="queue-title-actions">{platformMode ? null : <button className="primary" type="button" onClick={() => setIntakeOpen(true)} title="Житель позвонил по телефону: заведите заявку за него">+ Заявка по звонку</button>}<div className="segmented" role="group" aria-label="Что показать"><button type="button" aria-pressed={!archiveView} onClick={() => setArchiveView(false)}>Очередь</button><button type="button" aria-pressed={archiveView} onClick={() => setArchiveView(true)}>Архив</button></div></div></div>
            <div className="queue-toolbar">
              <form className="toolbar-field number-search" onSubmit={(event) => { event.preventDefault(); setNumberFilter(numberInput.replace(/\D/g, '')); }}><label htmlFor="incident-number">Номер заявки</label><div className="input-group"><input id="incident-number" type="search" inputMode="numeric" value={numberInput} onChange={(event) => { setNumberInput(event.target.value); if (!event.target.value) setNumberFilter(''); }} placeholder="Например, 1024" /><button className="filter" type="submit">Найти</button></div></form>
              <Picker label="Улица или дом" options={buildingPickerOptions(allBuildings, { streets: true, prefix: 'building:' })} value={placeFilter} onChange={setPlaceFilter} placeholder="Все дома" emptyLabel="Все дома" disabled={Boolean(numberFilter)} searchPlaceholder="Улица или номер дома" />
              <label className="toolbar-field">Порядок<select value={incidentSort} onChange={(event) => setIncidentSort(event.target.value as typeof incidentSort)}><option value="urgency_desc">Сначала срочные</option><option value="importance_desc">Сначала массовые</option><option value="importance_asc">Сначала единичные</option><option value="date_desc">Сначала новые</option><option value="date_asc">Сначала старые</option><option value="updated_desc">Недавно обновлённые</option><option value="due_asc">Ближайший срок</option><option value="category">По типу проблемы</option><option value="zone">По месту</option><option value="address">По адресу</option></select></label>
              <button className="filter toolbar-refresh" type="button" onClick={() => void reloadIncidents()}>Обновить</button>
            </div>
            <div className="queue-toolbar secondary">
              <label className="toolbar-field">Тип проблемы<select value={categoryFilter} disabled={Boolean(numberFilter)} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Все типы</option>{Object.entries(categoryLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
              <label className="toolbar-field">Место<select value={zoneFilter} disabled={Boolean(numberFilter)} onChange={(event) => setZoneFilter(event.target.value)}><option value="">Любое место</option>{Object.entries(zoneLabels).map(([key, text]) => <option key={key} value={key}>{key === 'apartment' ? 'Квартира (личные заявки)' : key === 'common' ? 'Другое общедомовое' : text}</option>)}</select></label>
              <label className="toolbar-field">Статус<select value={statusFilter} disabled={Boolean(numberFilter)} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Любой статус</option>{(archiveView ? ['resolved', 'rejected'] as Status[] : ['new', 'acknowledged', 'in_progress'] as Status[]).map((key) => <option key={key} value={key}>{statusLabels[key]}</option>)}</select></label>
              <label className="toolbar-field">Срочность<select value={priorityFilter} disabled={Boolean(numberFilter)} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">Любая</option><option value="emergency">Аварии</option><option value="high">Срочные</option><option value="normal">Обычные</option></select></label>
              {(placeFilter || categoryFilter || zoneFilter || statusFilter || priorityFilter) && <button className="filter toolbar-refresh" type="button" onClick={() => { setPlaceFilter(''); setCategoryFilter(''); setZoneFilter(''); setStatusFilter(''); setPriorityFilter(''); }}>Сбросить фильтры</button>}
            </div>
          </div>
          <div className="incident-list">
            {loadState === 'loading' && <p className="state-message">Загружаем заявки…</p>}
            {loadState === 'error' && <p className="state-message error">Не удалось загрузить заявки: нет связи с сервером. Нажмите «Обновить» через минуту.</p>}
            {loadState === 'ready' && numberFilter && <p className="state-message">{incidents.length ? `Найдена заявка № ${numberFilter}.` : `Заявки № ${numberFilter} нет. Проверьте номер.`} <button className="text-button" type="button" onClick={() => { setNumberFilter(''); setNumberInput(''); }}>Показать все заявки</button></p>}
            {loadState === 'ready' && !numberFilter && incidents.length === 0 && (placeFilter || categoryFilter || zoneFilter || statusFilter) && <p className="state-message">Под выбранные фильтры заявок нет. <button className="text-button" type="button" onClick={() => { setPlaceFilter(''); setCategoryFilter(''); setZoneFilter(''); setStatusFilter(''); }}>Сбросить фильтры</button></p>}
            {loadState === 'ready' && !numberFilter && !(placeFilter || categoryFilter || zoneFilter || statusFilter) && incidents.length === 0 && <p className="state-message">{archiveView ? 'В архиве пока ничего нет. Сюда попадают устранённые и отклонённые заявки.' : 'Новых заявок нет. Они появятся здесь, как только жители напишут в бот.'}</p>}
            {loadState === 'ready' && incidents.map((incident) => (
              <article className={`incident clickable priority-${incident.priority}`} key={incident.id} role="button" tabIndex={0} aria-label={`Заявка № ${incident.number}: ${incident.title}`} onClick={() => void openIncident(incident.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openIncident(incident.id); } }}>
                <div className="incident-code"><span className="plate" title="Номер заявки. Его же видит житель в боте.">№ {incident.number}</span><time>{formatShortDate(incident.createdAt, incident.timeZone)}</time></div>
                <div className="incident-main"><h3>{incident.title}</h3><p>{incident.address}, {formatPlace(incident).toLowerCase()}</p>{incident.legalTerm && !['resolved', 'rejected'].includes(incident.status) ? <small className={`legal-term ${new Date(incident.legalTerm.dueAt).getTime() < Date.now() ? 'late' : ''}`} title={`${incident.legalTerm.title}. ${incident.legalTerm.source}`}>По закону: {termLeft(incident.legalTerm.dueAt)}</small> : null}</div>
                <div className="reports" title="Жителей, обратившихся по заявке, и комментариев в обсуждении"><strong>{incident.reportsCount} {plural(incident.reportsCount, 'житель', 'жителя', 'жителей')}</strong><small>{incident.commentsCount ?? 0} {plural(incident.commentsCount ?? 0, 'комментарий', 'комментария', 'комментариев')}</small></div>
                <span className="badges">{incident.source === 'phone' ? <span className="badge phone" title="Заявку завёл диспетчер по телефонному звонку">По звонку</span> : null}{incident.priority === 'emergency' ? <span className="badge urgency-emergency">Авария</span> : incident.priority === 'high' ? <span className="badge urgency-high">Срочная</span> : null}<span className={`badge ${statusTone(incident.status)}`}>{statusLabels[incident.status]}</span></span>
                <span className="open" aria-hidden="true">Открыть</span>
              </article>
            ))}
          </div>
        </section></>}
      </main>
      {intakeOpen && <PhoneIncidentDrawer buildings={allBuildings} onClose={() => setIntakeOpen(false)} onCreated={async (id) => { setIntakeOpen(false); setArchiveView(false); await reloadIncidents(true); await openIncident(id); }} onNotice={notify} />}
      {selected && <IncidentDrawer incident={selected} onClose={() => setSelected(null)} onSaved={async () => { setSelected(null); await reloadIncidents(); }} onCommentDeleted={async () => { await openIncident(selected.id); await reloadIncidents(true); }} onNotice={notify} />}
      {notice && <div className={`toast ${notice.tone}`} role="status"><span>{notice.tone === 'success' ? '✓' : '!'}</span><p>{notice.text}</p><button type="button" onClick={() => setNotice(null)} aria-label="Закрыть уведомление">×</button></div>}
    </div>
  );
}

function Login({ onSuccess, health, theme, onToggleTheme }: { onSuccess: (admin: Admin) => void; health: HealthState; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [botUrl, setBotUrl] = useState<string | null>(null);
  useEffect(() => { void api<{ botUrl: string | null }>('/api/admin/session/meta').then(({ botUrl: url }) => setBotUrl(url)).catch(() => setBotUrl(null)); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { onSuccess((await api<{ admin: Admin }>('/api/admin/session', { method: 'POST', body: JSON.stringify({ username, password }) })).admin); }
    catch (failure) { setError(failure instanceof ApiError && failure.status === 429 ? 'Слишком много попыток. Подождите 5 минут.' : 'Неверный логин или пароль.'); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><button className="text-button theme-toggle login-theme" type="button" onClick={onToggleTheme} aria-pressed={theme === 'dark'}>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button><div className="login-card">
    <Brand subtitle="Веб-диспетчерская" /><h1>Вход</h1>
    <section className="login-way">
      <h2>Через MAX</h2>
      <p className="form-hint">В боте «Домовед» нажмите «Веб-диспетчерская УК» или «Веб-админка платформы» — придёт одноразовая ссылка на 5 минут.</p>
      {botUrl ? <a className="primary login-max" href={botUrl} target="_blank" rel="noreferrer">Открыть бота в MAX</a> : null}
    </section>
    <form className="login-way" onSubmit={submit}>
      <h2>По логину и паролю</h2>
      <label>Логин<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
      <label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={8} /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      <p className="form-hint">Пароль задаётся в разделе «Учётная запись» после входа через MAX.</p>
    </form>
    <p className={`login-health ${health}`}>{health === 'online' ? 'Сервер на связи' : health === 'checking' ? 'Проверяем связь с сервером…' : 'Нет связи с сервером'}</p>
  </div></div>;
}

function AccountSettings({ admin, onSaved, onNotice }: { admin: Admin; onSaved: (admin: Admin) => void; onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [username, setUsername] = useState(admin.username.startsWith('max_') ? '' : admin.username);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    if (password !== repeat) { setError('Пароли не совпадают.'); return; }
    setBusy(true);
    try {
      const result = await api<{ admin: Admin }>('/api/admin/session/password', { method: 'PUT', body: JSON.stringify({ username, password }) });
      onSaved(result.admin); setPassword(''); setRepeat('');
      onNotice('Логин и пароль сохранены. Теперь можно входить на сайте.');
    } catch (failure) { setError(failure instanceof ApiError && failure.code === 'username_taken' ? 'Такой логин уже занят.' : 'Логин — латиница, цифры, точка, дефис (от 3 символов); пароль — от 10 символов.'); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-panel"><div className="panel-head"><div><h2>Вход на сайт</h2><p className="form-hint">Сейчас вы {admin.username.startsWith('max_') ? 'входите только через MAX' : `входите через MAX и по логину «${admin.username}»`}.</p></div></div>
    <form className="status-form settings-form" onSubmit={save}>
      <label>Логин<input required minLength={3} maxLength={60} pattern="[A-Za-z0-9._\-]+" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="admin" /></label>
      <label>Новый пароль<input type="password" required minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><span className="field-hint">Не короче 10 символов. После 5 неверных попыток вход блокируется на 5 минут.</span></label>
      <label>Пароль ещё раз<input type="password" required minLength={10} value={repeat} onChange={(event) => setRepeat(event.target.value)} autoComplete="new-password" /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить логин и пароль'}</button>
    </form></section>;
}

function BuildingsManager({ onNotice, canDelete, transferFrom }: { onNotice: (text: string, tone?: Notice['tone']) => void; canDelete: boolean; transferFrom?: string | null }) {
  const [items, setItems] = useState<Building[]>([]);
  const [editing, setEditing] = useState<Building | null>(null);
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [apartmentsCount, setApartmentsCount] = useState('100');
  const [entrancesCount, setEntrancesCount] = useState('1');
  const [chatLink, setChatLink] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { setItems((await api<{ items: Building[] }>('/api/buildings')).items); } catch { setError('Не удалось загрузить дома: нет связи с сервером.'); } };
  useEffect(() => { void reload(); }, []);
  const reset = () => { setEditing(null); setStreet(''); setHouse(''); setApartmentsCount('100'); setEntrancesCount('1'); setChatLink(''); setError(''); };
  const startEdit = (item: Building) => { setEditing(item); setStreet(item.street); setHouse(item.house); setApartmentsCount(String(item.apartmentsCount)); setEntrancesCount(String(item.entrancesCount)); setChatLink(item.chatLink ?? ''); setError(''); };
  const query = filter.trim().toLowerCase();
  const visible = query ? items.filter((item) => item.address.toLowerCase().includes(query)) : items;
  const groups = groupByStreet(visible);
  const streets = [...new Set(items.map((item) => item.street))];
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const body = { street, house, apartmentsCount: Number(apartmentsCount), entrancesCount: Number(entrancesCount), chatLink: chatLink.trim() || null };
      await api(editing ? `/api/buildings/${editing.id}` : '/api/buildings', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      const message = editing ? 'Данные дома обновлены.' : 'Дом добавлен.';
      reset(); await reload(); onNotice(message);
    } catch (requestError) {
      const message = requestError instanceof ApiError && requestError.code === 'building_exists' ? 'Такой дом на этой улице уже добавлен.' : requestError instanceof ApiError && requestError.code === 'apartments_in_use' ? 'Нельзя уменьшить число квартир: в квартирах с большими номерами есть жители, заявки или комментарии.' : 'Не удалось сохранить: проверьте улицу, номер дома, количество квартир и подъездов и ссылку на чат — она должна быть настоящей ссылкой https://…';
      setError(message); onNotice(message, 'error');
    } finally { setBusy(false); }
  }
  async function remove(item: Building) {
    if (!window.confirm(`Удалить дом «${item.address}»? Удалятся его квартиры, заявки и данные жителей. Жители дома будут отключены от бота. Действие нельзя отменить.`)) return;
    try {
      const result = await api<{ revokedMemberships: number }>(`/api/buildings/${item.id}`, { method: 'DELETE' });
      if (editing?.id === item.id) reset();
      await reload();
      onNotice(result.revokedMemberships ? `Дом удалён. ${result.revokedMemberships} ${plural(result.revokedMemberships, 'житель отключён', 'жителя отключены', 'жителей отключены')} от бота.` : 'Дом удалён.');
    } catch { const message = 'Не удалось удалить дом. Обновите страницу и попробуйте ещё раз.'; setError(message); onNotice(message, 'error'); }
  }
  return <><HousesMap houses={items.map((item) => ({ id: item.id, address: item.address, latitude: item.latitude ?? null, longitude: item.longitude ?? null }))} companyId={items[0]?.companyId ?? ''} /><div className="buildings-layout"><section className="panel buildings-panel">
    <div className="panel-head"><div><h2>Подключённые дома</h2><p className="form-hint">{items.length} {plural(items.length, 'дом', 'дома', 'домов')} на {streets.length} {plural(streets.length, 'улице', 'улицах', 'улицах')}. Жители выбирают в боте сначала улицу, потом дом.</p></div><div className="panel-actions"><label className="incident-sort">Поиск<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Улица или номер дома" /></label><button className="filter" onClick={() => void reload()}>Обновить</button></div></div>
    <div className="building-list">
      {items.length === 0 && <p className="state-message">Домов пока нет. Добавьте первый дом в форме справа — после этого жители смогут подключиться к боту.</p>}
      {items.length > 0 && groups.length === 0 && <p className="state-message">По запросу «{filter}» домов нет. Проверьте написание или очистите поиск.</p>}
      {groups.map(([streetName, houses]) => <div className="street-group" key={streetName}>
        <h3 className="street-title">{streetName}<span>{houses.length} {plural(houses.length, 'дом', 'дома', 'домов')}</span></h3>
        {houses.map((item) => <article className={`building-row ${editing?.id === item.id ? 'selected' : ''}`} key={item.id}><div><h3>{item.house ? `Дом ${item.house}` : item.address}</h3><p>{item.apartmentsCount} {plural(item.apartmentsCount, 'квартира', 'квартиры', 'квартир')}, {item.entrancesCount} {plural(item.entrancesCount, 'подъезд', 'подъезда', 'подъездов')}, {item._count?.incidents ?? 0} {plural(item._count?.incidents ?? 0, 'заявка', 'заявки', 'заявок')} за всё время</p><p className="form-hint">Чат дома: {item.chatLink ? item.chatLink : 'не указан'}</p>{canDelete ? <BuildingCode buildingId={item.id} onNotice={onNotice} /> : <p className="form-hint">Код дома для жителей показывает и меняет руководитель.</p>}</div><div className="building-actions"><button className="filter" onClick={() => startEdit(item)}>Редактировать</button><HouseQrButton buildingId={item.id} onNotice={onNotice} />{transferFrom ? <TransferHouse buildingId={item.id} address={item.address} currentCompanyId={transferFrom} onDone={() => void reload()} onNotice={onNotice} /> : null}{canDelete && <button className="filter danger" onClick={() => void remove(item)}>Удалить</button>}</div></article>)}
      </div>)}
    </div>
  </section>
  <form className="status-form building-form" onSubmit={submit}><h3>{editing ? `Редактировать: ${editing.address}` : 'Добавить дом'}</h3>
    <label>Улица<input required minLength={2} maxLength={200} list="known-streets" value={street} onChange={(event) => setStreet(event.target.value)} placeholder="ул. Ленина" /><datalist id="known-streets">{streets.map((name) => <option key={name} value={name} />)}</datalist><span className="field-hint">Выберите из подсказки, если улица уже есть, — так дома одной улицы окажутся вместе.</span></label>
    <label>Дом<input required maxLength={60} value={house} onChange={(event) => setHouse(event.target.value)} placeholder="10, корп. 2" /><span className="field-hint">Номер дома с корпусом или строением.</span></label>
    <label>Квартир в доме<input required type="number" min="1" max="2000" value={apartmentsCount} onChange={(event) => setApartmentsCount(event.target.value)} /><span className="field-hint">Квартиры с 1 по это число создадутся автоматически. Если позже увеличить число, недостающие квартиры добавятся.</span></label>
    <label>Подъездов<input required type="number" min="1" max="50" value={entrancesCount} onChange={(event) => setEntrancesCount(event.target.value)} /><span className="field-hint">Житель выбирает подъезд, когда сообщает о проблеме в подъезде или лифте.</span></label>
    <label>Ссылка на чат дома<input type="url" value={chatLink} onChange={(event) => setChatLink(event.target.value)} placeholder="https://max.ru/join/..." /><span className="field-hint">Необязательно. Ссылка-приглашение в чат MAX вида https://max.ru/join/… Бот покажет её кнопкой «Чат дома» в главном меню.</span></label>
    {!editing && <p className="form-hint">Код дома для жителей создастся автоматически. Посмотреть его можно в списке слева.</p>}
    {error && <p className="form-error">{error}</p>}
    <div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : editing ? 'Сохранить дом' : 'Добавить дом'}</button>{editing && <button className="filter" type="button" onClick={reset}>Отмена</button>}</div>
  </form></div></>;
}

// Buildings come from the server already sorted by street and house.
function groupByStreet<T extends { street: string }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.street, [...(groups.get(item.street) ?? []), item]);
  return [...groups.entries()];
}


function BuildingCode({ buildingId, onNotice }: { buildingId: string; onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  async function reveal() {
    if (code) { setCode(''); return; }
    setBusy(true);
    try { setCode((await api<{ code: string }>(`/api/buildings/${buildingId}/access-code`)).code); } catch { onNotice('Не удалось показать код дома.', 'error'); } finally { setBusy(false); }
  }
  async function change(value?: string) {
    if (!value && !window.confirm('Сгенерировать новый код дома? Старый код перестанет действовать для новых привязок.')) return;
    setBusy(true);
    try {
      const result = await api<{ code: string }>(`/api/buildings/${buildingId}/access-code`, { method: 'PATCH', body: JSON.stringify(value ? { code: value } : {}) });
      setCode(result.code); setEditing(false); setNewCode(''); onNotice('Код дома обновлён.');
    } catch { onNotice('Код дома должен состоять из 10 цифр.', 'error'); } finally { setBusy(false); }
  }
  return <div className="building-code"><div className="building-code-line"><span className="building-code-label">Код дома для жителей</span>{code ? <span className="plate">{code}</span> : <span className="building-code-hidden">••••••••••</span>}<span className="building-code-actions"><button className="filter small" type="button" disabled={busy} onClick={() => void reveal()}>{code ? 'Скрыть' : 'Показать'}</button><button className="filter small" type="button" disabled={busy} onClick={() => setEditing((value) => !value)}>{editing ? 'Отмена' : 'Задать свой'}</button><button className="filter small" type="button" disabled={busy} onClick={() => void change()} title="Заменить код на новый случайный">Сгенерировать новый</button></span></div><p className="form-hint">Жители вводят код в боте при подключении к квартире. Замена кода не отключает тех, кто уже подключён.</p>{editing && <form className="secret-row" onSubmit={(event) => { event.preventDefault(); void change(newCode); }}><input required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={newCode} onChange={(event) => setNewCode(event.target.value.replace(/\D/g, ''))} placeholder="10 цифр" aria-label="Новый код дома" /><button className="primary" disabled={busy || newCode.length !== 10}>Сохранить</button></form>}</div>;
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
  const [contractNumber, setContractNumber] = useState('');
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
  const selectApartment = (item: ApartmentAdminItem) => { setSelected(item); setNumber(item.number); setResidentsCount(item.profile?.residentsCount === null || item.profile?.residentsCount === undefined ? '' : String(item.profile.residentsCount)); setPeopleText(item.profile?.people.map((person) => `${person.fullName}${person.phones.length ? ` ${person.phones.join(' ')}` : ''}`).join('\n') ?? ''); setVehiclesText(item.vehicles.map((vehicle) => `${vehicle.licensePlate}${vehicle.owner ? ` ${vehicle.owner.fullName}${vehicle.owner.phones.length ? ` ${vehicle.owner.phones.join(' ')}` : ''}` : ''}`).join('\n')); setInviteCode(''); setContractNumber(item.contractNumber ?? ''); setClearInviteCode(false); setError(''); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError('');
    try {
      await api(`/api/apartments/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ number, residentsCount: residentsCount === '' ? null : Number(residentsCount), people: parsePeople(peopleText), vehicles: parseVehicles(vehiclesText), ...(contractNumber.trim() && contractNumber.trim() !== selected.contractNumber ? { contractNumber: contractNumber.trim() } : {}), ...(clearInviteCode ? { inviteCode: null } : inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}) }) });
      await search(); onNotice('Данные квартиры обновлены.');
    } catch (requestError) { const message = requestError instanceof ApiError && requestError.code === 'apartment_number_taken' ? 'Такая квартира уже есть в этом доме.' : requestError instanceof ApiError && requestError.code === 'vehicle_belongs_to_another_apartment' ? 'Этот автомобиль уже привязан к другой квартире.' : requestError instanceof ApiError && requestError.code === 'apartment_has_no_residents' ? 'Нельзя добавить автомобиль: в квартире нет привязанного жителя.' : 'Не удалось сохранить данные квартиры. Проверьте формат строк.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm(`Удалить квартиру ${selected.number}? Будут удалены её привязки жителей, профиль и автомобили. Заявки останутся в истории без номера квартиры.`)) return;
    setBusy(true); setError('');
    try { await api(`/api/apartments/${selected.id}`, { method: 'DELETE' }); setSelected(null); await search(); onNotice('Квартира и её привязанные данные удалены.'); } catch { const message = 'Не удалось удалить квартиру.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  return <div className="apartments-layout"><section className="panel apartments-panel"><div className="panel-head"><div><h2>Поиск квартир</h2><p className="refresh-info">Номер квартиры ищется точно: «5» найдёт только квартиру 5, а не 15 или 50. Текст ищется в ФИО жильцов. Выберите дом, чтобы не смешивать квартиры с одинаковыми номерами из разных домов.</p></div></div><form className="apartment-search" onSubmit={(event) => { event.preventDefault(); void search(); }}><Picker label="Дом" options={buildingPickerOptions(buildings)} value={buildingId} onChange={setBuildingId} placeholder="Все дома" emptyLabel="Все дома" searchPlaceholder="Улица или номер дома" /><label>Квартира или житель<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="5 или Иванов" title="Номер квартиры ищется точно: 5 найдёт только квартиру 5. Текст ищется в ФИО жильцов." /></label><label>Сортировка<select value={sort} onChange={(event) => setSort(event.target.value as 'apartment' | 'resident')}><option value="apartment">По квартирам</option><option value="resident">По ФИО жильца</option></select></label><label className="checkbox-label apartment-filter"><input type="checkbox" checked={withResidents} onChange={(event) => setWithResidents(event.target.checked)} /> Только квартиры с жителями</label><button className="primary" disabled={searching}>{showSearching ? 'Ищем…' : 'Найти'}</button></form>{error && <p className="form-error apartments-error">{error}</p>}<div className="building-list apartment-list">{items.length === 0 && !searching && <p className="state-message">Ничего не найдено.</p>}{items.map((item) => <article className={`building-row apartment-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id}><button className="apartment-select" type="button" onClick={() => selectApartment(item)}><strong>Квартира {item.number}</strong><span>{item.building.address}</span><small>{item.profile?.people.length ? item.profile.people.map((person) => person.fullName).join(', ') : 'Жильцы не указаны'}. В боте: {item._count.memberships} {plural(item._count.memberships, 'житель', 'жителя', 'жителей')}{item.hasInviteCode ? ', есть код квартиры' : ''}</small></button><button className="open" type="button" onClick={() => selectApartment(item)} aria-label={`Открыть квартиру ${item.number}`}>Открыть</button></article>)}</div></section>{selected && <div className="overlay apartment-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><form className="drawer status-form apartment-editor" onSubmit={save}><button className="drawer-close" type="button" onClick={() => setSelected(null)}>×</button><h3>Квартира {selected.number}</h3><p className="form-hint">{selected.building.address}</p><div className="connected-residents"><strong>Подключены в боте ({selected.memberships?.length ?? 0})</strong>{selected.memberships?.length ? <ul>{selected.memberships.map((member, index) => <li key={index}><span>{member.user.displayName || 'Без имени в MAX'}{member.user.maxUsername ? ` (@${member.user.maxUsername})` : ''}</span><span className="form-hint">{member.user.sharedPhone ? formatSharedPhone(member.user.sharedPhone) : 'номер не указан'} · с {formatFullDate(member.verifiedAt)}</span></li>)}</ul> : <p className="form-hint">Никто из жителей этой квартиры ещё не подключился к боту.</p>}<p className="form-hint">Имя и ник берутся из профиля MAX. Номер житель добавляет сам кнопкой «Поделиться номером» в боте.</p></div><label>Номер квартиры<input required value={number} onChange={(event) => setNumber(event.target.value)} /></label><label>Количество жильцов<input type="number" min="0" max="100" value={residentsCount} onChange={(event) => setResidentsCount(event.target.value)} placeholder="Не указано" /></label><label>Жильцы<textarea rows={6} value={peopleText} onChange={(event) => setPeopleText(event.target.value)} placeholder={'ФИО телефон\nИванов Иван +79000000000'} /></label><label>Автомобили<textarea rows={6} value={vehiclesText} onChange={(event) => setVehiclesText(event.target.value)} placeholder={'Номер владелец телефон\nА123ВС Иван +79000000000'} /></label><label>Номер договора управления<input value={contractNumber} onChange={(event) => setContractNumber(event.target.value)} placeholder="0000000000" /><span className="field-hint">От 4 до 30 символов: цифры, буквы и «/», обычно 10 цифр. С ним житель подключается сразу, без кодов — в приложении и в боте.</span></label><label>Индивидуальный код квартиры<input minLength={6} maxLength={64} value={inviteCode} disabled={clearInviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder={selected.hasInviteCode ? 'Код установлен — введите новый для замены' : 'Необязательно, от 6 символов'} /></label><label className="checkbox-label"><input type="checkbox" checked={clearInviteCode} onChange={(event) => setClearInviteCode(event.target.checked)} /> Удалить индивидуальный код</label><p className="form-hint">Код квартиры — дополнительная защита: житель вводит его после кода дома. Задайте его, если не хотите, чтобы к квартире подключился кто-то, кто знает только код дома. Сохранённый код нельзя посмотреть, только заменить.</p><p className="form-hint">В полях «Жильцы» и «Автомобили» — одна запись на строке, телефоны через пробел или запятую. Удалённые строки удаляются и из бота.</p>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button><button className="filter danger" type="button" disabled={busy} onClick={() => void remove()}>Удалить квартиру</button></form></div>}</div>;
}

function AnnouncementsManager({ onNotice }: { onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [audience, setAudience] = useState<'all' | 'street' | 'building' | 'apartment'>('all');
  const [street, setStreet] = useState('');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [apartments, setApartments] = useState<ApartmentRecipient[]>([]);
  const [apartmentId, setApartmentId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const apartmentsOfBuilding = apartments.filter((apartment) => apartment.building.id === buildingId);
  const [history, setHistory] = useState<AnnouncementItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  // Sent announcements are current until they are put into the archive:
  // residents see only the current ones.
  const [archiveView, setArchiveView] = useState(false);
  const [counts, setCounts] = useState<{ current: number; archived: number } | null>(null);
  async function reloadHistory(page = historyPage, archived = archiveView) {
    try {
      const result = await api<{ items: AnnouncementItem[]; total: number; pageSize: number; counts: { current: number; archived: number } }>(`/api/announcements?page=${page}&archived=${archived}`);
      const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
      // The last item of the last page was moved away: show the page before it.
      if (!result.items.length && page > 1) { await reloadHistory(page - 1, archived); return; }
      setHistory(result.items); setHistoryTotal(pages); setHistoryPage(page); setCounts(result.counts);
    } catch { onNotice('Не удалось загрузить историю объявлений.', 'error'); }
  }
  function showArchive(archived: boolean) { setArchiveView(archived); void reloadHistory(1, archived); }
  async function moveAnnouncement(item: AnnouncementItem, action: 'archive' | 'restore') {
    try { await api(`/api/announcements/${item.id}/${action}`, { method: 'POST' }); await reloadHistory(); onNotice(action === 'archive' ? 'Объявление убрано в архив: жители его больше не видят.' : 'Объявление снова видно жителям.'); } catch { onNotice('Не удалось перенести объявление.', 'error'); }
  }
  async function removeAnnouncement(item: AnnouncementItem) {
    if (!window.confirm('Удалить объявление насовсем? Восстановить его будет нельзя. Уже доставленные сообщения останутся у жителей в чате с ботом.')) return;
    try { await api(`/api/announcements/${item.id}`, { method: 'DELETE' }); await reloadHistory(); onNotice('Объявление удалено.'); } catch { onNotice('Не удалось удалить объявление.', 'error'); }
  }
  useEffect(() => {
    void reloadHistory(1, false);
    void api<{ items: ApartmentRecipient[] }>('/api/announcements/apartments').then(({ items }) => setApartments(items)).catch(() => setNotice('Не удалось загрузить список квартир.'));
    void api<{ items: Building[] }>('/api/buildings').then(({ items }) => setBuildings(items)).catch(() => setNotice('Не удалось загрузить список домов.'));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const target = audience === 'apartment' ? { apartmentId } : audience === 'building' ? { buildingId } : audience === 'street' ? { street } : {};
      const result = await api<{ recipientsCount: number }>('/api/announcements', { method: 'POST', body: JSON.stringify({ audience, ...target, text }) });
      const message = `Сообщение поставлено в очередь для ${result.recipientsCount} получателей.`;
      setText(''); setNotice(message); onNotice(message); await reloadHistory(1);
    } catch (requestError) { const message = requestError instanceof ApiError && requestError.code === 'recipients_not_found' ? 'Нет подключённых жителей для выбранных получателей.' : 'Не удалось отправить сообщение. Выберите получателей и проверьте текст.'; setNotice(message); onNotice(message, 'error'); }
    finally { setBusy(false); }
  }
  return <section className="panel announcements-panel"><div className="panel-head"><div><h2>Новое объявление</h2><p className="form-hint">Бот пришлёт текст получателям и сохранит его в разделе «Объявления УК».</p></div></div><form className="status-form announcement-form" onSubmit={submit}><label>Кому<select value={audience} onChange={(event) => { setAudience(event.target.value as 'all' | 'street' | 'building' | 'apartment'); setApartmentId(''); }}><option value="all">Всем подключённым жителям всех домов</option><option value="street">Жителям всех домов одной улицы</option><option value="building">Жителям одного дома</option><option value="apartment">Конкретной квартире</option></select></label>{audience === 'street' && <div className="field-with-hint"><Picker label="Улица" required options={groupByStreet(buildings).map(([streetName, houses]) => ({ value: streetName, label: streetName, hint: `${houses.length} ${plural(houses.length, 'дом', 'дома', 'домов')}` }))} value={street} onChange={setStreet} placeholder="Выберите улицу" searchPlaceholder="Название улицы" /><span className="field-hint">Например, при отключении воды на всей улице.</span></div>}{audience === 'building' && <Picker label="Дом" required options={buildingPickerOptions(buildings)} value={buildingId} onChange={setBuildingId} placeholder="Выберите дом" searchPlaceholder="Улица или номер дома" />}{audience === 'apartment' && <><Picker label="Дом" required options={buildingPickerOptions(buildings, { disabled: (building) => apartments.some((apartment) => apartment.building.id === building.id) ? null : 'нет подключённых жителей' })} value={buildingId} onChange={(value) => { setBuildingId(value); setApartmentId(''); }} placeholder="Сначала выберите дом" searchPlaceholder="Улица или номер дома" /><div className="field-with-hint"><Picker label="Квартира" required disabled={!buildingId} options={apartmentsOfBuilding.map((apartment) => ({ value: apartment.id, label: `Квартира ${apartment.number}`, hint: `${apartment._count.memberships} ${plural(apartment._count.memberships, 'житель', 'жителя', 'жителей')} в боте` }))} value={apartmentId} onChange={setApartmentId} placeholder={buildingId ? 'Выберите квартиру' : 'Сначала выберите дом'} searchPlaceholder="Номер квартиры" /><span className="field-hint">В списке только квартиры, где кто-то подключён к боту.</span></div></>}<label>Текст сообщения<textarea required minLength={3} maxLength={2000} rows={6} value={text} onChange={(event) => setText(event.target.value)} placeholder="Например: Завтра с 10:00 до 14:00 будет профилактическое отключение воды." /></label><p className="form-hint">Получат только жители, подключённые к боту. Сообщения уходят в течение минуты; если MAX временно недоступен, бот повторит отправку сам. Отправленное сообщение нельзя отозвать из чатов жителей — проверьте текст.</p>{notice && <p className={notice.startsWith('Не удалось') ? 'form-error' : 'form-hint'}>{notice}</p>}<button className="primary" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить'}</button></form><div className="announcement-history"><div className="announcement-history-head"><h3>Отправленные объявления</h3><div className="segmented" role="group" aria-label="Какие объявления показать"><button type="button" aria-pressed={!archiveView} onClick={() => showArchive(false)}>Актуальные{counts ? ` · ${counts.current}` : ''}</button><button type="button" aria-pressed={archiveView} onClick={() => showArchive(true)}>Архив{counts ? ` · ${counts.archived}` : ''}</button></div></div><p className="form-hint">{archiveView ? 'Жители не видят эти объявления ни в боте, ни в приложении. Объявление можно вернуть или удалить насовсем.' : 'Эти объявления жители видят в разделе «Объявления УК». Неактуальное уберите в архив.'}</p>{history.length === 0 ? <p className="form-hint">{archiveView ? 'Архив пуст.' : 'Актуальных объявлений нет.'}</p> : history.map((item) => <article className="report-card" key={item.id}><strong>{announcementAudience(item)} · {formatFullDate(item.createdAt)} · {item.recipientsCount} получателей</strong><p>{item.text}</p><small className="form-hint">Отправил: {item.admin.username}{item.archivedAt ? ` · в архиве с ${formatFullDate(item.archivedAt)}` : ''}</small><div className="building-actions">{archiveView ? <button className="filter" type="button" onClick={() => void moveAnnouncement(item, 'restore')}>Вернуть жителям</button> : <button className="filter" type="button" onClick={() => void moveAnnouncement(item, 'archive')}>В архив</button>}<button className="filter danger" type="button" onClick={() => void removeAnnouncement(item)}>Удалить</button></div></article>)}{historyTotal > 1 && <div className="building-actions"><button className="filter" type="button" disabled={historyPage <= 1} onClick={() => void reloadHistory(historyPage - 1)}>Новее</button><span className="form-hint">Страница {historyPage} из {historyTotal}</span><button className="filter" type="button" disabled={historyPage >= historyTotal} onClick={() => void reloadHistory(historyPage + 1)}>Ранее</button></div>}</div></section>;
}

type AnnouncementItem = { id: string; audience: 'all' | 'street' | 'building' | 'apartment'; street: string | null; text: string; recipientsCount: number; createdAt: string; archivedAt: string | null; building: { address: string } | null; apartment: { number: string; building: { address: string } } | null; admin: { username: string } };

function announcementAudience(item: AnnouncementItem) {
  if (item.audience === 'street') return `Улица: ${item.street ?? 'не указана'}`;
  if (item.audience === 'building') return `Дом: ${item.building?.address ?? 'удалён'}`;
  if (item.audience === 'apartment') return item.apartment ? `Квартира ${item.apartment.number}, ${item.apartment.building.address}` : 'Квартира удалена';
  return 'Всем жителям';
}

type UkContact = { name: string; phone: string; email: string | null; address: string | null; workingHours: string | null; receptionHours: string | null; daysOff: string | null; cleaningInfo: string | null; note: string | null };

function UkContactsManager({ onNotice, onSaved }: { onNotice: (text: string, tone?: Notice['tone']) => void; onSaved?: (name: string) => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', workingHours: '', receptionHours: '', daysOff: '', cleaningInfo: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ item: UkContact | null }>('/api/settings/uk-contacts').then(({ item }) => {
      if (item) setForm({ name: item.name, phone: item.phone, email: item.email ?? '', address: item.address ?? '', workingHours: item.workingHours ?? '', receptionHours: item.receptionHours ?? '', daysOff: item.daysOff ?? '', cleaningInfo: item.cleaningInfo ?? '', note: item.note ?? '' });
    }).catch(() => onNotice('Не удалось загрузить контакты УК.', 'error'));
  }, []);
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm((value) => ({ ...value, [key]: event.target.value })) });
  const phone = normalizeRussianPhone(form.phone);
  const phoneInvalid = form.phone.trim() !== '' && !phone;
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!phone) { setError('Укажите российский номер из 10 цифр после +7 или 8, например +7 (3452) 12-34-56.'); return; }
    setBusy(true);
    try {
      const { item } = await api<{ item: UkContact }>('/api/settings/uk-contacts', { method: 'PUT', body: JSON.stringify(form) });
      setForm((value) => ({ ...value, phone: item.phone }));
      onNotice('Профиль УК сохранён.'); onSaved?.(item.name);
    } catch { const message = 'Не удалось сохранить: проверьте название, телефон и email.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel"><div className="panel-head"><div><h2>Название и контакты УК</h2><p className="form-hint">Название видят жители в боте и в приложении, а вы — в шапке диспетчерской.</p></div></div><form className="status-form settings-form" onSubmit={save}><label>Название управляющей компании<input required minLength={2} maxLength={200} {...field('name')} placeholder="ООО «Управляющая компания»" /></label><label>Телефон<input required type="tel" inputMode="tel" maxLength={40} aria-invalid={phoneInvalid} {...field('phone')} placeholder="+7 (3452) 12-34-56" />{phoneInvalid ? <span className="field-hint form-error">Нужен российский номер: 10 цифр после +7 или 8. Короткие номера вроде 112 укажите в разделе «Службы».</span> : phone ? <span className="phone-preview">Жители увидят: {formatRussianPhone(phone)}</span> : <span className="field-hint">Мобильный или городской, в любом привычном виде.</span>}</label><label>Email<input type="email" maxLength={200} {...field('email')} placeholder="uk@example.ru" /><span className="field-hint">Необязательно.</span></label><label>Адрес офиса<input maxLength={300} {...field('address')} placeholder="ул. Ленина, 1, офис 2" /></label><label>Часы работы<input maxLength={300} {...field('workingHours')} placeholder="Пн–Пт 9:00–18:00, обед 13:00–14:00" /><span className="field-hint">Укажите и перерыв, если он есть.</span></label><label>Приём граждан<input maxLength={300} {...field('receptionHours')} placeholder="Вт 10:00–13:00, Чт 15:00–19:00" /></label><label>Выходные дни<input maxLength={200} {...field('daysOff')} placeholder="Сб, Вс и праздничные дни" /></label><label>Уборка и благоустройство<textarea rows={3} maxLength={1500} {...field('cleaningInfo')} placeholder="Влажная уборка подъездов — раз в неделю, двор — ежедневно" /><span className="field-hint">Жители видят это в «Моя УК» и в боте, в «Контактах УК».</span></label><label>Дополнительно<textarea rows={3} maxLength={1000} {...field('note')} placeholder="Например: приём по личным вопросам — по вторникам" /></label>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy || phoneInvalid}>{busy ? 'Сохраняем…' : 'Сохранить контакты'}</button></form></section>;
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
  return <div className="buildings-layout"><section className="panel buildings-panel"><div className="panel-head"><div><h2>Номера служб</h2><p className="form-hint">Бот показывает их в том же порядке, в каком они добавлены.</p></div><button className="filter" onClick={() => void reload()}>Обновить</button></div><div className="building-list">{items.length === 0 && <p className="state-message">Служб пока нет. Пока список пуст, бот советует жителям звонить 112. Там же — «Быстрый набор»: короткие номера, которые жители набирают в одно касание; без своего списка показываются 112, 101, 102, 103, 104.</p>}{items.map((item) => <article className="building-row" key={item.id}><div><h3>{item.name}</h3><p className="service-phone">{item.phone}</p><p className="form-hint">{item.description}</p></div><div className="building-actions"><button className="filter" onClick={() => { setEditing(item); setName(item.name); setPhone(item.phone); setDescription(item.description); setError(''); }}>Редактировать</button><button className="filter danger" onClick={async () => { if (!window.confirm(`Удалить контакт «${item.name}»?`)) return; try { await api(`/api/emergency-services/${item.id}`, { method: 'DELETE' }); await reload(); onNotice('Контакт службы удалён.'); } catch { const message = 'Не удалось удалить контакт службы.'; setError(message); onNotice(message, 'error'); } }}>Удалить</button></div></article>)}</div></section><form className="status-form building-form" onSubmit={submit}><h3>{editing ? 'Редактировать службу' : 'Добавить службу'}</h3><label>Название службы<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Аварийная служба водоканала" /></label><label>Телефон<input required minLength={3} maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 (900) 000-00-00" /></label><label>Краткое описание<textarea required minLength={2} maxLength={400} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="За что отвечает служба и когда обращаться" /></label><p className="form-hint">Здесь можно указать и короткие номера: 112, 101, 104.</p>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : editing ? 'Сохранить службу' : 'Добавить службу'}</button>{editing && <button className="filter" type="button" onClick={reset}>Отмена</button>}</form></div>;
}

function IncidentDrawer({ incident, onClose, onSaved, onCommentDeleted, onNotice }: { incident: IncidentDetail; onClose: () => void; onSaved: () => Promise<void>; onCommentDeleted: () => Promise<void>; onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const viewablePhotos = incident.photos.filter((photo): photo is typeof photo & { url: string } => Boolean(photo.url));
  const [status, setStatus] = useState<Status>(incident.status);
  const [dueAt, setDueAt] = useState(incident.dueAt ? toZoneInput(incident.dueAt, incident.timeZone) : '');
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
    const plannedDueAt = withoutDueAt || isTerminal || !dueAt ? null : zoneInputToIso(dueAt, incident.timeZone);
    const dueAtUnchanged = Boolean(plannedDueAt && incident.dueAt && new Date(plannedDueAt).getTime() === new Date(incident.dueAt).getTime());
    if (!withoutDueAt && !isTerminal && (!plannedDueAt || (!dueAtUnchanged && new Date(plannedDueAt).getTime() <= Date.now()))) { setError('Плановый срок должен быть в будущем.'); setBusy(false); return; }
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
          setDueAt(item.dueAt ? toZoneInput(item.dueAt, item.timeZone) : ''); setWithoutDueAt(!item.dueAt);
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
    {viewer !== null && viewablePhotos[viewer] && <PhotoViewer photos={viewablePhotos} index={viewer} onChange={setViewer} onClose={() => setViewer(null)} />}
    <aside className="drawer"><button className="drawer-close" onClick={onClose}>×</button>
      <span className="plate">№ {incident.number}</span><h2>{incident.title}</h2><p className="drawer-meta">{incident.address}, {formatPlace(incident).toLowerCase()}</p>{incident.legalTerm && !['resolved', 'rejected'].includes(incident.status) ? <div className={`legal-box ${new Date(incident.legalTerm.dueAt).getTime() < Date.now() ? 'late' : ''}`}><strong>Срок по закону: {termLeft(incident.legalTerm.dueAt)}</strong><span>{incident.legalTerm.title}{incident.legalTerm.firstStep ? `; ${incident.legalTerm.firstStep}` : ''}. Крайний срок — {formatFullDate(incident.legalTerm.dueAt, incident.timeZone)} ({zoneOffset(incident.timeZone)}).</span><small>{incident.legalTerm.source}. Договор управления может устанавливать более короткий срок.</small></div> : null}
      {incident.source === 'phone' ? <div className="reports-block"><h3>Принята по телефону</h3><div className="report-card"><strong>{[incident.callerName, incident.callerPhone].filter(Boolean).join(', ') || 'Звонивший не представился'}</strong><p>{incident.callNote ?? incident.title}</p><time>{formatFullDate(incident.createdAt, incident.timeZone)}</time></div>{incident.reports.length === 0 ? <p className="form-hint">Жителей этой квартиры пока нет в MAX: о ходе работ сообщите звонившему сами.</p> : null}</div> : null}
      {incident.feedback?.length ? <div className="reports-block"><h3>Ответ жителей после «Устранена»</h3><p className="form-hint">Подтвердили: {incident.feedbackSummary?.confirmed ?? 0}, вернули в работу: {incident.feedbackSummary?.returned ?? 0}{incident.feedbackSummary?.ratingAverage ? `, средняя оценка ${incident.feedbackSummary.ratingAverage} из 5` : ''}.</p>{incident.feedback.map((item) => <div className={`report-card feedback-card ${item.resolved ? 'ok' : 'back'}`} key={item.id}><strong>Квартира {item.apartment?.number ?? 'не указана'}: {item.resolved ? `решено${item.rating ? ` · ${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}` : ''}` : 'не решено, вернул в работу'}</strong>{item.comment ? <p>{item.comment}</p> : null}<time>{formatFullDate(item.updatedAt, incident.timeZone)}</time></div>)}</div> : null}
      <div className="reports-block"><h3>Обращения жителей ({incident.reports.length})</h3>{incident.reports.map((report, index) => <div className="report-card" key={report.id}><strong>{index === 0 ? 'Заявитель' : 'Присоединился'}, квартира {report.apartment?.number ?? 'не указана'}</strong><p>{report.description || 'Присоединился: у него та же проблема'}</p><time>{formatFullDate(report.createdAt)}</time></div>)}</div>
      <div className="reports-block"><h3>Комментарии жителей ({incident.comments?.length ?? 0})</h3>{incident.comments?.length ? incident.comments.map((comment) => <div className="report-card" key={comment.id}><strong>Квартира {comment.apartment?.number ?? 'не указана'}</strong><p>{comment.text}</p><time>{formatFullDate(comment.createdAt, incident.timeZone)}</time><button className="filter danger comment-delete" type="button" onClick={async () => { if (!window.confirm('Удалить этот комментарий?')) return; try { await api(`/api/incidents/${incident.id}/comments/${comment.id}`, { method: 'DELETE' }); await onCommentDeleted(); onNotice('Комментарий удалён.'); } catch { const message = 'Не удалось удалить комментарий.'; setError(message); onNotice(message, 'error'); } }}>Удалить комментарий</button></div>) : <p className="form-hint">Комментариев пока нет.</p>}</div>
      <div className="reports-block"><h3>Фотографии ({incident.photos.length})</h3>{incident.photos.length === 0 ? <p className="form-hint">Фотографий пока нет.</p> : <div className="photo-grid">{incident.photos.map((photo) => photo.url ? <button type="button" className="photo-open" key={photo.id} onClick={() => setViewer(viewablePhotos.findIndex((item) => item.id === photo.id))} aria-label={`Открыть фото от квартиры ${photo.author.memberships[0]?.apartment.number ?? ''}`}><img src={photo.url} alt={`Фото от квартиры ${photo.author.memberships[0]?.apartment.number ?? ''}`} /></button> : <div className="photo-token" key={photo.id}>Фото от квартиры {photo.author.memberships[0]?.apartment.number ?? 'не указана'}<small>MAX: {photo.token.slice(0, 14)}…</small></div>)}</div>}</div>
      <div className="timeline"><h3>История ({incident.events.length})</h3>{incident.events.map((event) => <div className="timeline-item" key={event.id}><strong>{eventLabel(event.type)}</strong><time>{formatFullDate(event.createdAt, incident.timeZone)}</time></div>)}</div>
      <form className="status-form" onSubmit={save}><h3>Изменить заявку</h3><p className="form-hint">После сохранения бот сразу пришлёт новый статус, срок и комментарий всем жителям, которые обратились по этой заявке.</p>
        <label>Статус<select value={status} onChange={(e) => { const next = e.target.value as Status; setStatus(next); if (next === 'resolved') { setDelayReason(''); setComment(''); } }}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="field-hint">{statusHints[status]}</span></label>
        {!['resolved', 'rejected'].includes(status) && <><label>Плановый срок<input type="datetime-local" min={incident.dueAt && dueAt === toZoneInput(incident.dueAt, incident.timeZone) ? undefined : toZoneInput(new Date().toISOString(), incident.timeZone)} max={toZoneInput(new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(), incident.timeZone)} disabled={withoutDueAt} value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={withoutDueAt} onChange={(e) => setWithoutDueAt(e.target.checked)} /> Срок пока неизвестен</label><p className="form-hint">Срок можно не указывать. Время — местное время дома ({zoneOffset(incident.timeZone)}), не позже чем через 3 года. Жители увидят срок в карточке заявки.</p></>}
        {status === 'rejected' ? <label>Причина отклонения<textarea required value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={3} placeholder="Почему заявку нельзя принять" /></label> : status !== 'resolved' && <><label>Причина переноса<input value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Например: ждём поставку детали" /><span className="field-hint">Заполните, если сдвигаете срок — жители увидят причину.</span></label><label>Комментарий жильцам<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Что сделано или когда ждать результат" /></label></>}
        {incident.archivedAt && <button className="filter" type="button" onClick={async () => { setBusy(true); setError(''); try { await api(`/api/incidents/${incident.id}`, { method: 'PATCH', body: JSON.stringify({ version: currentVersion, status, dueAt: ['resolved', 'rejected'].includes(status) || withoutDueAt || !dueAt ? null : zoneInputToIso(dueAt, incident.timeZone), rejectionReason: status === 'rejected' ? rejectionReason.trim() : null, archived: false }) }); await onSaved(); onNotice('Заявка восстановлена из архива.'); } catch { const message = 'Не удалось восстановить заявку.'; setError(message); onNotice(message, 'error'); } finally { setBusy(false); } }}>Восстановить из архива</button>}
        {error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить и уведомить жителей'}</button>
      </form>
    </aside>
  </div>;
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
// Same rules as the backend: Russian mobile or landline numbers only.
function normalizeRussianPhone(value: string): string | null {
  if (!/^[\d\s()+.-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8')) ? digits.slice(1) : digits.length === 10 ? digits : '';
  return /^[3489]\d{9}$/.test(national) ? `+7${national}` : null;
}
function formatRussianPhone(normalized: string) {
  const national = normalized.slice(2);
  return `+7 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8)}`;
}
const statusHints: Record<Status, string> = {
  new: 'Заявка пришла, её ещё никто не смотрел.',
  acknowledged: 'Заявку увидели и приняли, работы ещё не начаты.',
  in_progress: 'Работы идут. Укажите срок, если он известен.',
  resolved: 'Проблема устранена. Заявка уйдёт в архив.',
  rejected: 'Заявку не будут выполнять. Причину увидят жители. Заявка уйдёт в архив.',
};
// The stored choice wins; otherwise the theme follows the system setting.
export function currentTheme(): 'light' | 'dark' {
  try {
    const stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* storage may be unavailable */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// The logo: a house in a circle in the accent blue. Drawn as SVG so it stays
// sharp at any size and works on the dark sidebar and the light login page.
function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <circle className="brand-mark-circle" cx="20" cy="20" r="19.25" />
    <rect className="brand-mark-house" x="25" y="11.5" width="3" height="6" rx="0.6" />
    <path className="brand-mark-house" d="M13 19.2 L20 13 L27 19.2 V29 a1 1 0 0 1 -1 1 H14 a1 1 0 0 1 -1 -1 Z" />
    <path className="brand-mark-roof" d="M9.6 20.6 L20 11.3 L30.4 20.6" />
    <rect className="brand-mark-door" x="18" y="23.2" width="4" height="6.8" rx="0.8" />
  </svg>;
}

function Brand({ subtitle = 'Диспетчерская УК' }: { subtitle?: string }) {
  return <div className="brand"><BrandMark /><span className="brand-text"><strong>Домовед</strong><span>{subtitle}</span></span></div>;
}
function formatPlace(incident: Pick<Incident, 'locationZone' | 'entranceNumber' | 'apartmentNumber'>) {
  const zone = zoneLabels[incident.locationZone] ?? incident.locationZone;
  if (incident.apartmentNumber) return `Квартира ${incident.apartmentNumber}`;
  if (!incident.entranceNumber) return zone;
  return incident.locationZone === 'entrance' ? `Подъезд ${incident.entranceNumber}` : `${zone}, подъезд ${incident.entranceNumber}`;
}
function statusTone(status: Status) { return ({ new: 'new', acknowledged: 'acknowledged', in_progress: 'progress', resolved: 'resolved', rejected: 'rejected' } as Record<Status, string>)[status]; }
function eventLabel(type: string) { return ({ incident_created: 'Обращение создано', incident_registered_by_phone: 'Диспетчер завёл заявку по звонку', resident_joined: 'Присоединился ещё один житель', incident_updated: 'УК обновила заявку', incident_escalated: 'Приоритет поднят: жители подтверждают проблему', resident_report_cancelled: 'Житель отменил своё обращение', resident_confirmed: 'Житель подтвердил: проблема решена', resident_reopened: 'Житель вернул в работу: проблема не решена' } as Record<string, string>)[type] ?? type; }
function CenteredMessage({ text }: { text: string }) { return <div className="centered-message">{text}</div>; }

const helpSections: Array<{ id: string; title: string }> = [
  { id: 'help-start', title: 'С чего начать' },
  { id: 'help-residents', title: 'Как подключаются жители' },
  { id: 'help-incidents', title: 'Заявки' },
  { id: 'help-statuses', title: 'Статусы заявок' },
  { id: 'help-buildings', title: 'Дома и коды' },
  { id: 'help-apartments', title: 'Квартиры' },
  { id: 'help-announcements', title: 'Объявления' },
  { id: 'help-services', title: 'Службы и контакты УК' },
  { id: 'help-roles', title: 'Роли и журнал действий' },
  { id: 'help-bot', title: 'Что видит житель в боте' },
  { id: 'help-miniapp', title: 'Мини-приложение в MAX' },
  { id: 'help-polls', title: 'Опросы и приём граждан' },
  { id: 'help-duties', title: 'Обязанности, сроки и данные' },
  { id: 'help-faq', title: 'Частые вопросы' },
];

function HelpPage({ onOpen }: { onOpen: (page: Page) => void }) {
  const go = (page: Page) => (event: { preventDefault: () => void }) => { event.preventDefault(); onOpen(page); };
  return <div className="help-layout">
    <nav className="help-toc" aria-label="Содержание справки">{helpSections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
    <div className="help-content">
      <section className="help-section" id="help-start">
        <h2>С чего начать</h2>
        <p>Диспетчерская работает вместе с ботом в MAX: жители пишут о проблемах в бот, а вы видите их здесь, отвечаете и сообщаете о ходе работ. Чтобы запустить работу с новым домом:</p>
        <ol>
          <li>Добавьте дом в разделе <a href="#" onClick={go('buildings')}>«Дома»</a>: адрес, число квартир и подъездов.</li>
          <li>Откройте код дома и раздайте его жителям — на доске объявлений, в квитанции или в чате дома.</li>
          <li>Заполните <a href="#" onClick={go('settings')}>«Профиль УК»</a>, <a href="#" onClick={go('emergency-services')}>«Службы»</a> и проверьте <a href="#" onClick={go('duties')}>«Обязанности УК»</a> — жители увидят их в приложении и в боте.</li>
          <li>Следите за <a href="#" onClick={go('incidents')}>«Заявками»</a>: новые обращения появятся там сами.</li>
        </ol>
      </section>

      <section className="help-section" id="help-residents">
        <h2>Как подключаются жители</h2>
        <ol>
          <li>Житель открывает бота в MAX и нажимает «Начать».</li>
          <li>Выбирает дом. Если домов немного, бот сразу показывает список. Если больше 20 — сначала улицу, потом номер дома (длинный список домов листается). В любой момент можно нажать «Найти по адресу» и написать адрес как удобно: «садовая 7», «Мира 12 к1» — «ул.», «д.», регистр и буква «ё» не важны.</li>
          <li>Соглашается на обработку персональных данных (один раз), вводит номер квартиры и затем код дома из 10 цифр или номер договора управления квартиры. С номером договора житель подключается сразу, без кодов и подтверждения соседей.</li>
          <li>Если у квартиры есть индивидуальный код, бот спросит и его — с верным кодом квартиры житель подключается сразу.</li>
          <li>Если в квартире уже есть подключённые жители, а кода квартиры нет, новый человек не подключается сам: бот присылает жителям квартиры запрос «Принять / Отклонить». Если они не отвечают, запрос можно решить в разделе «Квартиры». Так человек со случайным номером квартиры не попадёт в чужую квартиру.</li>
        </ol>
        <p>После этого житель привязан к квартире: может сообщать о проблемах, видеть общие заявки дома и получать объявления. При пяти неверных кодах подряд бот начинает привязку заново.</p>
        <p>При переезде житель выбирает «Моя квартира → Сменить дом или квартиру». Уведомления по заявкам прежнего адреса отключаются, а сами заявки остаются у него в архиве. Бот предложит удалить данные прежней квартиры, если там больше никто не подключён.</p>
      </section>

      <section className="help-section" id="help-incidents">
        <h2>Заявки</h2>
        <p>Если несколько жителей сообщают об одной и той же проблеме в одном месте за последние сутки, бот предлагает присоединиться к уже существующей заявке. Поэтому одна заявка может объединять обращения многих жителей — число в строке показывает, сколько их.</p>
        <h3>Номера заявок</h3>
        <p>Каждая заявка получает сквозной номер: № 1, № 2 и дальше. Номера выдаёт база данных, поэтому две заявки никогда не получат один номер. Тот же номер житель видит в боте и в уведомлениях — по нему заявку можно найти в поле «Номер заявки».</p>
        <h3>Очередь и архив</h3>
        <p>Очередь можно сузить до улицы или дома, типа проблемы (вода, лифт, уборка…), места (подъезд, лифт, двор, квартира) и статуса — фильтры складываются, «Сбросить фильтры» возвращает всё. Порядок можно выбрать: по поддержке жителей, по дате, по ближайшему сроку, по последнему обновлению, по типу проблемы, по месту или по адресу. В очереди — заявки, которые ещё не устранены и не отклонены. По умолчанию сверху массовые: те, к которым присоединилось больше всего жителей. Порядок можно сменить на «Сначала новые».</p>
        <p>Устранённые и отклонённые заявки уходят в архив. Из архива заявку можно открыть и вернуть в работу кнопкой «Восстановить из архива».</p>
        <h3>Заявка по звонку</h3>
        <p>Если житель позвонил по телефону, нажмите «+ Заявка по звонку» над очередью: дом, квартира звонившего, что и где случилось, срочность, имя и телефон. Заявка сразу встаёт в очередь со статусом «Принята» и отметкой «По звонку». Если жители этой квартиры подключены к боту, они получат заявку в MAX и дальше будут видеть её статус, как если бы написали сами. Имя и телефон звонившего видят только сотрудники УК.</p>
        <h3>Проверка жителем</h3>
        <p>Когда вы ставите статус «Устранена», бот спрашивает каждого обратившегося жителя: «Проблема действительно решена?». «Да, решено» — житель может оценить работу от 1 до 5. «Не решено» — заявка сразу возвращается в работу и выходит из архива, а сотрудники получают сообщение в MAX с тем, что осталось не так. Ответить можно в течение 14 дней. Ответы видны в карточке заявки, а в «Показателях» — доля устранённых заявок, которые подтвердили жители, и средняя оценка.</p>
        <h3>Карточка заявки</h3>
        <ul>
          <li><strong>Обращения жителей</strong> — что написал каждый и из какой квартиры. Первым идёт заявитель.</li>
          <li><strong>Комментарии жителей</strong> — обсуждение общей заявки соседями. Неуместный комментарий можно удалить.</li>
          <li><strong>Фотографии</strong> — до 3 от каждого жителя и до 9 на заявку.</li>
          <li><strong>История</strong> — кто и когда создал заявку, присоединился, отменил обращение, изменил статус, подтвердил результат или вернул заявку в работу.</li>
        </ul>
        <p>Когда вы сохраняете изменения, бот присылает всем обратившимся жителям новый статус, плановый срок, причину переноса и ваш комментарий.</p>
        <p className="help-note">Заявки «по квартире» (протечка, нет воды в квартире) видят только сам житель и диспетчер. Соседи их не видят и присоединиться не могут.</p>
      </section>

      <section className="help-section" id="help-statuses">
        <h2>Статусы заявок</h2>
        <dl>
          <dt>Новая</dt><dd>{statusHints.new}</dd>
          <dt>Принята</dt><dd>{statusHints.acknowledged}</dd>
          <dt>В работе</dt><dd>{statusHints.in_progress}</dd>
          <dt>Устранена</dt><dd>{statusHints.resolved}</dd>
          <dt>Отклонена</dt><dd>{statusHints.rejected}</dd>
        </dl>
        <p>Статус можно менять в любом порядке, например сразу с «Новая» на «Устранена». Плановый срок указывается по местному времени дома (пояс показан рядом с полем) и должен быть в будущем. Уже прошедший срок можно оставить без изменений.</p>
        <p>Если два диспетчера одновременно правят одну заявку, второй увидит сообщение, что данные обновились, и сохранит свои изменения поверх актуальной версии.</p>
      </section>

      <section className="help-section" id="help-buildings">
        <h2>Дома и коды</h2>
        <p>Дом задаётся улицей и номером. При добавлении выбирайте улицу из подсказки, если она уже есть: дома одной улицы группируются вместе и в списке, и в боте, а объявление можно отправить сразу всей улице. Один и тот же дом дважды добавить нельзя.</p>
        <p>У каждого дома свой десятизначный код. Жители вводят его при подключении к квартире, поэтому раздавайте его только жителям этого дома.</p>
        <ul>
          <li><strong>Показать код</strong> — увидеть текущий код, чтобы передать его жителям.</li>
          <li><strong>Новый случайный</strong> — заменить код, например если он попал к посторонним. Уже подключённые жители останутся подключены, новый код нужен только для новых подключений.</li>
          <li><strong>Задать свой</strong> — ввести код вручную, например чтобы он совпадал с напечатанным в квитанциях.</li>
        </ul>
        <p><strong>QR-код для подъезда</strong> — у каждого дома в списке. Распечатайте листовку и повесьте у входа или у лифта: житель наводит камеру, и бот в MAX открывается сразу с этим домом. Остаётся указать квартиру и подтвердить её кодом дома или номером договора. Сам QR-код доступа к квартире не даёт.</p>
        <p>Удаление дома удаляет все его заявки, квартиры и данные жителей. Жители дома отключаются и при следующем обращении к боту выбирают квартиру заново. Действие нельзя отменить.</p>
      </section>

      <section className="help-section" id="help-apartments">
        <h2>Квартиры</h2>
        <p>Номер квартиры ищется точно: «5» найдёт только квартиру 5, а не 15 или 50. Текст ищется в ФИО жильцов. Можно ограничить поиск одним домом или показать только квартиры, где уже есть подключённые жители.</p>
        <p>В карточке квартиры можно поправить число жильцов, ФИО, телефоны и автомобили — те же данные житель заполняет сам в боте в разделе «Моя квартира». Автомобиль можно добавить, только если в квартире есть подключённый житель.</p>
        <h3>Индивидуальный код квартиры</h3>
        <p>Код дома знают все его жители. Если нужно, чтобы к конкретной квартире не подключился сосед, задайте ей отдельный код: бот спросит его после кода дома. Код хранится так, что прочитать его нельзя даже диспетчеру — только заменить или удалить.</p>
      </section>

      <section className="help-section" id="help-announcements">
        <h2>Объявления</h2>
        <p>Объявление приходит жителям сообщением в бот и сохраняется в разделе бота «Объявления УК». Там житель видит 5 последних объявлений, а более ранние — на следующих страницах. Неактуальное объявление уберите в архив: жители перестанут его видеть, а у вас оно останется во вкладке «Архив» — оттуда его можно вернуть или удалить насовсем.</p>
        <dl>
          <dt>Всем жителям</dt><dd>Получат все подключённые жители всех домов.</dd>
          <dt>Одной улице</dt><dd>Все дома на улице, например при плановом отключении воды.</dd>
          <dt>Одному дому</dt><dd>Например, об отключении воды в конкретном доме.</dd>
          <dt>Одной квартире</dt><dd>Личное сообщение. Новые жильцы этой квартиры его не увидят.</dd>
        </dl>
        <p>Ошибочное объявление можно удалить из архива бота, но из чатов жителей оно не исчезнет.</p>
      </section>

      <section className="help-section" id="help-services">
        <h2>Службы и контакты УК</h2>
        <p><strong>Службы</strong> — аварийные и обслуживающие телефоны: водоканал, лифтовая служба, электрики. Можно указывать и короткие номера вроде 112. Пока список пуст, бот советует жителям звонить 112.</p>
        <p><strong>Профиль УК</strong> — название, телефон, email, адрес офиса, часы работы и приёма, выходные, уборка и благоустройство. Офис ставится на карту по адресу. Телефон проверяется: подходит российский мобильный или городской номер, сохраняется он в едином виде +7 (XXX) XXX-XX-XX.</p>
      </section>

      <section className="help-section" id="help-roles">
        <h2>Права и журнал действий</h2>
        <p>У всех сотрудников УК одинаковые права: заявки, дома и их коды, квартиры, объявления, службы и контакты УК.</p>
        <p>Изменения домов, кодов, квартир, служб, контактов и рассылки записываются в журнал действий: кто и когда это сделал. Сотрудники входят без пароля: кнопка «Веб-диспетчерская УК» в боте или «Веб-пульт на компьютере» в приложении присылает одноразовую ссылку на 5 минут. Администратор платформы может войти и по логину и паролю. Сессия действует 12 часов. Новых сотрудников приглашают в разделе «Команда», там же можно выйти из сотрудников УК.</p>
      </section>

      <section className="help-section" id="help-bot">
        <h2>Что видит житель в боте</h2>
        <dl>
          <dt>Сообщить о проблеме</dt><dd>Общедомовая проблема или проблема квартиры, категория, место, описание и фото.</dd>
          <dt>Мои заявки</dt><dd>Заявки по текущему адресу и архив: завершённые и заявки прежних адресов.</dd>
          <dt>Заявки дома</dt><dd>Общие проблемы дома, к которым можно присоединиться и оставить комментарий.</dd>
          <dt>Моя квартира</dt><dd>Жители квартиры в боте с именами и номерами из MAX (номер житель добавляет кнопкой «Поделиться номером»), другие жильцы без бота, автомобили и показ телефона при поиске авто, смена адреса.</dd>
          <dt>Соседи</dt><dd>Поиск владельца автомобиля по номеру, сообщение другой квартире, чат дома.</dd>
          <dt>Объявления УК</dt><dd>Ваши объявления с архивом.</dd>
          <dt>Контакты УК</dt><dd>Данные из раздела «Профиль УК».</dd>
          <dt>Экстренные службы</dt><dd>Данные из раздела «Службы».</dd>
        </dl>
        <p>Телефоны жильцов соседи видят только при поиске автомобиля и только если житель сам разрешил показ.</p>
      </section>

      <section className="help-section" id="help-miniapp">
        <h2>Мини-приложение в MAX</h2>
        <p>Кнопка «Открыть приложение» в боте открывает мини-приложение Домоведа. Бот при этом продолжает работать как раньше: уведомления, фото к заявкам и диалоги остаются в чате.</p>
        <dl>
          <dt>Жители</dt><dd>Находят дом на карте или по адресу, подтверждают квартиру кодом дома или номером договора, подают заявки и присоединяются к заявкам соседей, читают объявления.</dd>
          <dt>Сотрудники УК</dt><dd>Вкладка «Пульт»: заявки, дома на карте, объявления, подключение жителей и показатели. Сотрудника приглашает руководитель ссылкой — пароль не нужен, вход по аккаунту MAX.</dd>
          <dt>Новые заявки</dt><dd>Сотрудникам с аккаунтом MAX приходит сообщение о каждой новой заявке. Общая заявка поднимается в очереди, когда к ней присоединяются 3, 5 и 10 жителей.</dd>
          <dt>Добавить дом</dt><dd>В мини-приложении: «Пульт» → «Дома на карте» → «+ Дом». Адрес, этажность и год постройки подставляются по карте и открытым данным, остальное вводится вручную.</dd>
          <dt>Несколько УК</dt><dd>Каждая УК видит только свои дома и заявки. Подключает УК администратор платформы.</dd>
        </dl>
        <p>Подробная справка по ролям — в самом мини-приложении: «Ещё» → «Как пользоваться».</p>
      </section>

      <section className="help-section" id="help-polls">
        <h2>Опросы и приём граждан</h2>
        <p><a href="#" onClick={go('polls')}>«Опросы»</a> — вопрос жителям всех домов УК или одного дома: от 2 до 15 вариантов и время окончания. Голос — один от квартиры. В анонимном опросе жители видят только числа, в открытом — и какие квартиры за что; здесь квартиры видны всегда. Можно разрешить или запретить менять голос и завершить опрос раньше срока. Когда время выходит или опрос завершён вручную, он сам переходит во вкладку «Архив» с итогами; оттуда его можно удалить. Жители получают уведомление о новом опросе в MAX.</p>
        <p><a href="#" onClick={go('appointments')}>«Приём граждан»</a> — окна приёма на день: время начала и конца и длительность одного визита. Жители записываются в приложении и пишут тему визита; о записи и отмене приходит сообщение в MAX. Отменённый вами приём житель тоже получает сообщением.</p>
      </section>

      <section className="help-section" id="help-duties">
        <h2>Обязанности УК, сроки и персональные данные</h2>
        <p>Что УК должна делать по закону и в какие сроки, жители читают в приложении и в боте. Текст — в разделе <a href="#" onClick={go('duties')}>«Обязанности УК»</a>: по умолчанию общий текст по ПП РФ № 416, № 354, № 290 и Постановлению Госстроя № 170, УК может сохранить свою версию со сроками из договора.</p>
        <p>У каждой заявки в очереди и в карточке показан срок по закону — самый долгий, который допускают правила, и сколько осталось. Сотрудникам в MAX приходят напоминания: когда остаётся четверть срока (но не меньше часа) и когда срок истёк.</p>
        <p>Перед первым подключением к квартире житель даёт согласие на обработку персональных данных по политике, которую ведёт администратор платформы. Когда житель отвязывается от квартиры, согласие отзывается: телефон и автомобили стираются, заявки остаются в истории УК.</p>
      </section>

      <section className="help-section" id="help-faq">
        <h2>Частые вопросы</h2>
        <h3>Житель не может подключиться</h3>
        <p>Проверьте, что он выбирает правильный дом и вводит код именно этого дома. Если у квартиры задан индивидуальный код, бот спросит и его. Номер квартиры должен быть не больше числа квартир в доме. Проще всего — подключиться по номеру договора: он задаётся в карточке квартиры.</p>
        <h3>Житель не получил уведомление</h3>
        <p>Уведомления получают только жители, которые обратились по заявке или присоединились к ней и не переехали. Отправка занимает до минуты; при сбое MAX бот повторяет её сам.</p>
        <h3>Нужно убрать заявку-дубль</h3>
        <p>Отклоните её и укажите причину, например «Дубль заявки № …». Жители получат уведомление, а заявка уйдёт в архив.</p>
      </section>
    </div>
  </div>;
}

function PhotoViewer({ photos, index, onChange, onClose }: { photos: Array<{ id: string; url: string; createdAt: string; author: { memberships: Array<{ apartment: { number: string } }> } }>; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const photo = photos[index]!;
  const go = (step: number) => onChange((index + step + photos.length) % photos.length);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фото" onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <figure>
      <img src={photo.url} alt={`Фото от квартиры ${photo.author.memberships[0]?.apartment.number ?? ''}`} />
      <figcaption>Фото {index + 1} из {photos.length}, квартира {photo.author.memberships[0]?.apartment.number ?? 'не указана'}, {formatFullDate(photo.createdAt)}</figcaption>
    </figure>
    {photos.length > 1 && <><button type="button" className="photo-nav previous" onClick={() => go(-1)} aria-label="Предыдущее фото">‹</button><button type="button" className="photo-nav next" onClick={() => go(1)} aria-label="Следующее фото">›</button></>}
    <button type="button" className="photo-close" onClick={onClose} aria-label="Закрыть просмотр">×</button>
  </div>;
}

type PickerOption = { value: string; label: string; group?: string; hint?: string; disabled?: boolean };

// A select with search for long lists (buildings, apartments). Unlike a native
// select its list is as wide as it needs to be and long names wrap instead of
// running out of the column.
function Picker({ options, value, onChange, placeholder, emptyLabel, disabled, required, label, searchPlaceholder = 'Поиск' }: {
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  label: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const normalized = query.trim().toLowerCase().replace(/ё/g, 'е');
  const all: PickerOption[] = emptyLabel !== undefined ? [{ value: '', label: emptyLabel }, ...options] : options;
  // Exact matches come first: typing "4" puts apartment 4 above 43 and 54.
  const exact = (option: PickerOption) => option.label.toLowerCase().replace(/ё/g, 'е').split(/\s+/).includes(normalized);
  const visible = normalized
    ? all.filter((option) => `${option.group ?? ''} ${option.label} ${option.hint ?? ''}`.toLowerCase().replace(/ё/g, 'е').includes(normalized))
      .sort((left, right) => Number(exact(right)) - Number(exact(left)))
    : all;
  const selectable = visible.filter((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => { setActive(0); }, [query, open]);

  const choose = (option: PickerOption) => { if (option.disabled) return; onChange(option.value); setOpen(false); setQuery(''); };
  const onKeyDown = (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, selectable.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    if (event.key === 'Enter') { event.preventDefault(); const option = selectable[active]; if (option) choose(option); }
  };

  let lastGroup: string | undefined;
  return <div className={`picker ${open ? 'is-open' : ''}`} ref={root}>
    <span className="picker-label">{label}</span>
    <button type="button" className="picker-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} title={selected ? `${selected.group ? `${selected.group}, ` : ''}${selected.label}` : undefined}>
      <span className={selected || (value === '' && emptyLabel) ? '' : 'picker-placeholder'}>{selected ? (selected.group ? `${selected.group}, ${selected.label}` : selected.label) : value === '' && emptyLabel ? emptyLabel : placeholder}</span>
    </button>
    {required && <input className="picker-proxy" tabIndex={-1} required value={value} onChange={() => undefined} aria-hidden="true" />}
    {open && <div className="picker-panel" role="listbox" aria-label={label}>
      <input className="picker-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder={searchPlaceholder} aria-label={`${searchPlaceholder}: ${label}`} />
      <div className="picker-options">
        {visible.length === 0 && <p className="picker-empty">Ничего не найдено. Проверьте написание.</p>}
        {visible.map((option) => {
          const header = option.group && option.group !== lastGroup ? <div className="picker-group" key={`group-${option.group}`}>{option.group}</div> : null;
          lastGroup = option.group;
          const index = selectable.indexOf(option);
          return <Fragment key={option.value || 'empty'}>{header}<button type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} className={`picker-option ${option.group ? 'grouped' : ''} ${index === active ? 'active' : ''}`} onMouseEnter={() => index >= 0 && setActive(index)} onClick={() => choose(option)}><span>{option.label}</span>{option.hint && <small>{option.hint}</small>}</button></Fragment>;
        })}
      </div>
    </div>}
  </div>;
}

// Buildings for a Picker: grouped by street, a house is shown by its number.
function buildingPickerOptions(buildings: Building[], settings: { streets?: boolean; prefix?: string; disabled?: (building: Building) => string | null } = {}): PickerOption[] {
  return groupByStreet(buildings).flatMap(([streetName, houses]) => [
    ...(settings.streets ? [{ value: `street:${streetName}`, label: 'Вся улица', group: streetName, hint: `${houses.length} ${plural(houses.length, 'дом', 'дома', 'домов')}` }] : []),
    ...houses.map((building) => {
      const reason = settings.disabled?.(building) ?? null;
      return { value: `${settings.prefix ?? ''}${building.id}`, label: building.house ? `дом ${building.house}` : building.address, group: streetName, ...(reason ? { hint: reason, disabled: true } : {}) };
    }),
  ]);
}

const categoryLabels: Record<string, string> = {
  water: 'Водоснабжение', electricity: 'Электричество', heating: 'Отопление', elevator: 'Лифт', leak: 'Протечка', cleaning: 'Уборка', other: 'Другое',
};

type JoinRequestItem = { id: string; createdAt: string; requesterName: string; apartmentNumber: string; address: string; residentsCount: number };

// Requests to join apartments that already have residents. Shown only when
// there is something to decide: usually the residents answer in the bot.
function JoinRequestsPanel({ onNotice }: { onNotice: (text: string, tone?: Notice['tone']) => void }) {
  const [items, setItems] = useState<JoinRequestItem[]>([]);
  const [busy, setBusy] = useState('');
  const reload = async () => { try { setItems((await api<{ items: JoinRequestItem[] }>('/api/join-requests')).items); } catch { /* the panel stays hidden */ } };
  useEffect(() => { void reload(); const timer = window.setInterval(() => void reload(), 30_000); return () => window.clearInterval(timer); }, []);
  async function decide(item: JoinRequestItem, decision: 'approve' | 'reject') {
    if (decision === 'approve' && !window.confirm(`Подключить «${item.requesterName}» к квартире ${item.apartmentNumber} (${item.address})? Убедитесь, что этот человек действительно живёт в квартире.`)) return;
    setBusy(item.id);
    try {
      await api(`/api/join-requests/${item.id}/${decision}`, { method: 'POST' });
      onNotice(decision === 'approve' ? `${item.requesterName} подключён к квартире ${item.apartmentNumber}. Бот сообщил ему об этом.` : `Запрос отклонён. Бот сообщил об этом ${item.requesterName}.`);
    } catch (requestError) {
      onNotice(requestError instanceof ApiError && requestError.code === 'already_decided' ? 'По этому запросу уже решили жители квартиры.' : 'Не удалось обработать запрос.', 'error');
    } finally { setBusy(''); await reload(); }
  }
  if (!items.length) return null;
  return <section className="panel join-requests"><div className="panel-head"><div><h2>Запросы на подключение ({items.length})</h2><p className="form-hint">Эти люди ввели верный код дома, но в квартире уже есть жители — бот спросил их, пускать ли нового человека. Если жители не отвечают, решите здесь. Запрос без ответа истекает через 7 дней.</p></div></div>
    <div className="building-list">{items.map((item) => <article className="building-row join-request" key={item.id}><div><h3>{item.requesterName}</h3><p>Хочет подключиться к квартире {item.apartmentNumber}, {item.address}</p><p className="form-hint">Запрос от {formatFullDate(item.createdAt)}. Уже подключено жителей: {item.residentsCount}.</p></div><div className="building-actions"><button className="primary" type="button" disabled={busy === item.id} onClick={() => void decide(item, 'approve')}>Подключить</button><button className="filter danger" type="button" disabled={busy === item.id} onClick={() => void decide(item, 'reject')}>Отклонить</button></div></article>)}</div>
  </section>;
}

function formatSharedPhone(phone: string) {
  return /^\+7\d{10}$/.test(phone) ? formatRussianPhone(phone) : phone;
}

function readActing(): { id: string; name: string } | null {
  try { return JSON.parse(window.sessionStorage.getItem('acting') ?? 'null') as { id: string; name: string } | null; } catch { return null; }
}

type SavedFilters = Partial<{ archiveView: boolean; placeFilter: string; categoryFilter: string; zoneFilter: string; statusFilter: string; priorityFilter: string; incidentSort: 'urgency_desc' | 'importance_desc' | 'importance_asc' | 'date_desc' | 'date_asc' | 'updated_desc' | 'due_asc' | 'category' | 'zone' | 'address' }>;
function readFilters(): SavedFilters {
  try { return JSON.parse(window.localStorage.getItem('desk-filters') ?? '{}') as SavedFilters; } catch { return {}; }
}

// "осталось 5 ч" or "просрочено на 2 дн." for the legal term of an incident.
function termLeft(dueAt: string, now = Date.now()) {
  const left = new Date(dueAt).getTime() - now;
  const total = Math.max(1, Math.round(Math.abs(left) / 3_600_000));
  const spelled = total < 48 ? `${total} ч` : `${Math.round(total / 24)} дн.`;
  return left >= 0 ? `осталось ${spelled}` : `просрочено на ${spelled}`;
}
