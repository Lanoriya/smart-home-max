import { useEffect, useState } from 'react';
import { Button, CellAction, CellSimple, Input, Segmented, Textarea, Typography, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type Company, type DeskAnnouncement, type Invite, type Stats } from '../api';
import { useConfirm } from '../components/confirm';
import { bridge } from '../bridge';
import { useNavigation } from '../nav';
import { useLoad, useSession } from '../session';
import { HouseMap, type Point } from '../components/HouseMap';
import { IconTile } from '../components/icons';
import { Actions, Empty, Failure, Field, IncidentCell, Loading, Page, Section, StatTile, Chips } from '../components/ui';
import { ago, categoryLabels, duration, formatDate, percent, plural, roleLabels, formatPhone, addressMatches } from '../labels';

// The desk of a management company in the mini-app.

export function MetricsGrid({ stats }: { stats: Stats }) {
  return (
    <div className="stats">
      <StatTile value={stats.open} label="открыто" tone={stats.open ? 'accent' : 'default'} />
      <StatTile value={stats.newOnes} label="ждут реакции" tone={stats.newOnes ? 'warn' : 'default'} />
      <StatTile value={stats.overdue} label="просрочено" tone={stats.overdue ? 'warn' : 'default'} />
      <StatTile value={stats.duplicatesAvoided} label="дублей не создано" hint="Жители присоединились к уже открытой заявке вместо новой" />
      <StatTile value={duration(stats.reactionMinutesMedian)} label="медиана реакции" />
      <StatTile value={percent(stats.onTimeShare)} label="решено в срок" />
    </div>
  );
}

// The platform administrator first chooses which company's desk to open.
function CompanyPicker() {
  const { setActing } = useSession();
  const overview = useLoad(() => api.platform.overview(), []);
  if (overview.error) return <Failure text={overview.error} retry={overview.reload} />;
  if (!overview.data) return <Loading />;
  return (
    <Page title="Пульт УК" subtitle="Выберите управляющую компанию, чтобы работать в её пульте">
      <Section>
        {overview.data.companies.map((company) => (
          <CellSimple key={company.id} as="button" onClick={() => setActing({ id: company.id, name: company.name })} title={company.name}
            subtitle={`${company.buildingsCount} ${plural(company.buildingsCount, 'дом', 'дома', 'домов')}, открыто ${company.stats.open}`} showChevron />
        ))}
      </Section>
    </Page>
  );
}

export function DeskScreen() {
  const { me, acting, setActing } = useSession();
  if (!acting) return me.admin?.role === 'platform_admin' ? <CompanyPicker /> : <Empty icon="shield" title="Нет доступа" />;
  return <Desk key={acting.id} canSwitch={me.admin?.role === 'platform_admin'} onSwitch={() => setActing(null)} />;
}

function Desk({ canSwitch, onSwitch }: { canSwitch: boolean; onSwitch: () => void }) {
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const overview = useLoad(() => api.desk.overview(), []);
  // The web desk of this company in the browser, signed in by a one-time link.
  const openWebDesk = async () => {
    try {
      const { url } = await api.desk.webLink();
      bridge.openLink(url);
      showSnackbar({ text: 'Веб-пульт открывается в браузере. Ссылка одноразовая и действует 5 минут.' });
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    }
  };
  const joins = useLoad(() => api.desk.joinRequests(), []);

  if (overview.error) return <Failure text={overview.error} retry={overview.reload} />;
  if (!overview.data) return <Loading />;
  const { company, stats, role } = overview.data;
  const supervisor = role !== 'dispatcher';



  return (
    <Page title={company.name} subtitle={roleLabels[role]}
      after={canSwitch ? <Button size="small" variant="secondary" onClick={onSwitch}>Сменить УК</Button> : undefined}>
      <EmergencyBlock />

      <Section header="Управление">
        <CellAction before={<IconTile name="incidents" color="#ff3b30" />} onClick={() => navigation.push({ name: 'desk-incidents' })} showChevron>Заявки: открыто {stats.open}{stats.newOnes ? `, ждут реакции ${stats.newOnes}` : ''}</CellAction>
        <CellAction before={<IconTile name="chart" color="#007aff" />} onClick={() => navigation.push({ name: 'desk-stats' })} showChevron>Показатели и статистика</CellAction>
        {joins.data?.length ? <CellAction before={<IconTile name="key" color="#ff9500" />} onClick={() => navigation.push({ name: 'desk-joins' })} showChevron>Подключение к квартирам: {joins.data.length}</CellAction> : null}
        <CellAction before={<IconTile name="map" color="#007aff" />} onClick={() => navigation.push({ name: 'desk-houses' })} showChevron>Дома на карте, {stats.buildings}</CellAction>
        <CellAction before={<IconTile name="megaphone" color="#34c759" />} onClick={() => navigation.push({ name: 'desk-broadcast' })} showChevron>Объявление жителям</CellAction>
        <CellAction before={<IconTile name="megaphone" color="#8a8f98" />} onClick={() => navigation.push({ name: 'desk-announcements' })} showChevron>Отправленные объявления и архив</CellAction>
        <CellAction before={<IconTile name="poll" color="#ff9500" />} onClick={() => navigation.push({ name: 'desk-polls' })} showChevron>Опросы жителей</CellAction>
        <CellAction before={<IconTile name="calendar" color="#5856d6" />} onClick={() => navigation.push({ name: 'desk-appointments' })} showChevron>Приём граждан</CellAction>
        {supervisor ? <CellAction before={<IconTile name="people" color="#5856d6" />} onClick={() => navigation.push({ name: 'desk-team' })} showChevron>Команда и приглашения</CellAction> : null}
        {supervisor ? <CellAction before={<IconTile name="building" color="#ff9500" />} onClick={() => navigation.push({ name: 'desk-company' })} showChevron>Карточка УК</CellAction> : null}
        {supervisor ? <CellAction before={<IconTile name="siren" color="#ff3b30" />} onClick={() => navigation.push({ name: 'desk-services' })} showChevron>Номера служб для жителей</CellAction> : null}
        {supervisor ? <CellAction before={<IconTile name="shield" color="#5856d6" />} onClick={() => navigation.push({ name: 'desk-duties' })} showChevron>Обязанности УК для жителей</CellAction> : null}
        {canSwitch ? null : <CellAction before={<IconTile name="platform" color="#8a8f98" />} onClick={() => void openWebDesk()} showChevron>Веб-пульт на компьютере</CellAction>}
      </Section>

    </Page>
  );
}

const statusFilters = [
  { id: 'active', title: 'Активные' },
  { id: 'emergency', title: 'Аварии' },
  { id: 'new', title: 'Новые' },
  { id: 'in_progress', title: 'В работе' },
  { id: 'archive', title: 'Архив' },
];

export function DeskIncidentsScreen({ initialStatus }: { initialStatus?: string }) {
  const navigation = useNavigation();
  const [filter, setFilter] = useState(initialStatus ?? 'active');
  const [sort, setSort] = useState('urgency_desc');
  const query: Record<string, string> = { sort, ...(filter === 'archive' ? { archive: 'true' } : filter === 'active' ? {} : filter === 'emergency' ? { priority: 'emergency' } : { status: filter }) };
  const list = useLoad(() => api.desk.incidents(query), [filter, sort]);
  return (
    <Page title="Заявки УК">
      <Chips label="Какие заявки" items={statusFilters} active={filter} onChange={setFilter} />
      <Chips label="Порядок" items={[{ id: 'urgency_desc', title: 'Сначала срочные' }, { id: 'importance_desc', title: 'Сначала массовые' }, { id: 'date_desc', title: 'Сначала свежие' }, { id: 'due_asc', title: 'По сроку' }]} active={sort} onChange={setSort} />
      {list.error ? <Failure text={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length ? (
        <Section>
          {list.data.map((incident) => (
            <IncidentCell key={incident.id} {...incident} when={incident.updatedAt} addressLine={incident.address} onClick={() => navigation.push({ name: 'desk-incident', id: incident.id })} />
          ))}
        </Section>
      ) : <Empty icon="inbox" title="Пусто" text="В этом разделе заявок нет." />}
    </Page>
  );
}

export function DeskBroadcastScreen({ buildingId }: { buildingId?: string }) {
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const houses = useLoad(() => api.desk.buildings(), []);
  const [target, setTarget] = useState<string>(buildingId ?? 'all');
  const [houseQuery, setHouseQuery] = useState('');
  // "all", one house, or one apartment of a house.
  const [audience, setAudience] = useState<'all' | 'house' | 'apartment'>(buildingId ? 'house' : 'all');
  const [apartmentNumber, setApartmentNumber] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      let body: Parameters<typeof api.desk.announce>[0] = { audience: 'all', text: text.trim() };
      if (audience === 'house') body = { audience: 'building', buildingId: target, text: text.trim() };
      if (audience === 'apartment') {
        const found = await api.desk.apartments(target, apartmentNumber.trim());
        const apartment = found.items.find((item) => item.number.toLowerCase() === apartmentNumber.trim().toLowerCase());
        if (!apartment) { showSnackbar({ text: `Квартиры ${apartmentNumber.trim()} в этом доме нет.` }); return; }
        if (!apartment.residents) { showSnackbar({ text: `В квартире ${apartment.number} пока никто не подключён — сообщение некому получить.` }); return; }
        body = { audience: 'apartment', apartmentId: apartment.id, text: text.trim() };
      }
      const result = await api.desk.announce(body);
      bridge.haptic('success');
      showSnackbar({ text: `Объявление отправлено: ${result.recipientsCount} ${plural(result.recipientsCount, 'житель', 'жителя', 'жителей')}` });
      navigation.back();
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Объявление жителям" subtitle="Придёт в чат с ботом и останется в разделе «Объявления»">
      {/* Houses may be many: "all" or one house found by its address. */}
      <Chips label="Кому" items={[{ id: 'all', title: 'Всем жителям УК' }, { id: 'house', title: 'Одному дому' }, { id: 'apartment', title: 'Одной квартире' }]} active={audience}
        onChange={(id) => { setAudience(id); setTarget(id === 'all' ? 'all' : (houses.data?.find((house) => house.id === target)?.id ?? '')); }} />
      {audience !== 'all' ? (
        <>
          <Input maxLength={100} value={houseQuery} onChange={(event) => setHouseQuery(event.target.value)} placeholder="Улица и номер дома" withClearButton />
          <HouseChoice houses={houses.data ?? []} query={houseQuery} selected={target} onSelect={setTarget} />
        </>
      ) : null}
      {audience === 'apartment' && target ? (
        <Field label="Номер квартиры" hint="Сообщение получат жители этой квартиры, подключённые к сервису.">
          <Input inputMode="numeric" value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} placeholder="Например, 45" />
        </Field>
      ) : null}
      <div className="form">
        <Textarea placeholder="Например: 22 октября с 10:00 до 14:00 отключение холодной воды в связи с ремонтом стояка" rows={5} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} />
        <Button size="large" stretched loading={busy} disabled={text.trim().length < 3 || busy || !target || (audience === 'apartment' && !apartmentNumber.trim())} onClick={() => void send()}>Отправить</Button>
      </div>
    </Page>
  );
}

function announcementAudience(item: DeskAnnouncement) {
  if (item.audience === 'street') return `Улица: ${item.street ?? 'не указана'}`;
  if (item.audience === 'building') return `Дом: ${item.building?.address ?? 'удалён'}`;
  if (item.audience === 'apartment') return item.apartment ? `Кв. ${item.apartment.number}, ${item.apartment.building.address}` : 'Квартира удалена';
  return 'Всем жителям';
}

// Sent announcements: the current ones residents see, and the archive the
// company put away. From the archive an announcement is returned or deleted.
export function DeskAnnouncementsScreen() {
  const navigation = useNavigation();
  const confirm = useConfirm();
  const { showSnackbar } = useSnackbar();
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const list = useLoad(() => api.desk.announcements(archived, page), [archived, page]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const after = async () => {
    // The last item of the last page went away: show the page before it.
    if (list.data && list.data.items.length === 1 && page > 1) setPage(page - 1); else await list.reload();
  };
  const move = async (item: DeskAnnouncement) => {
    try {
      await api.desk.archiveAnnouncement(item.id, !archived);
      showSnackbar({ text: archived ? 'Объявление снова видно жителям' : 'Убрано в архив: жители его больше не видят' });
      await after();
    } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  const remove = async (item: DeskAnnouncement) => {
    if (!await confirm({ text: 'Удалить объявление насовсем? Восстановить его будет нельзя. Уже доставленные сообщения останутся у жителей в чате с ботом.', confirm: 'Удалить', destructive: true })) return;
    try { await api.desk.deleteAnnouncement(item.id); showSnackbar({ text: 'Объявление удалено' }); await after(); } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  const counts = list.data?.counts;
  return (
    <Page title="Объявления жителям" subtitle={archived ? 'Жители не видят архивные объявления. Их можно вернуть или удалить' : 'Эти объявления жители видят в разделе «Объявления»'}
      after={<Button size="small" onClick={() => navigation.push({ name: 'desk-broadcast' })}>+ Объявление</Button>}>
      <Segmented items={[{ id: 'current', title: `Актуальные${counts ? ` · ${counts.current}` : ''}` }, { id: 'archive', title: `Архив${counts ? ` · ${counts.archived}` : ''}` }]} activeItem={archived ? 'archive' : 'current'}
        onClick={(id) => { setArchived(id === 'archive'); setPage(1); }} />
      {list.error ? <Failure text={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.items.length ? (
        <div className="announcements">
          {list.data.items.map((item) => (
            <article key={item.id} className="announcement">
              <header className="announcement-head">
                <span>{announcementAudience(item)}, {ago(item.createdAt)}</span>
                <span className="announcement-read">{item.recipientsCount} {plural(item.recipientsCount, 'получатель', 'получателя', 'получателей')}</span>
              </header>
              <p className="announcement-text pre-wrap">{item.text}</p>
              <div className="button-pair">
                <Button size="medium" variant="secondary" stretched onClick={() => void move(item)}>{archived ? 'Вернуть жителям' : 'В архив'}</Button>
                <Button size="medium" variant="secondary" stretched onClick={() => void remove(item)}>Удалить</Button>
              </div>
            </article>
          ))}
          {pages > 1 ? (
            <div className="button-pair">
              <Button size="medium" variant="secondary" stretched disabled={page <= 1} onClick={() => setPage(page - 1)}>Новее</Button>
              <Button size="medium" variant="secondary" stretched disabled={page >= pages} onClick={() => setPage(page + 1)}>Ранее</Button>
            </div>
          ) : null}
        </div>
      ) : archived
        ? <Empty icon="megaphone" title="Архив пуст" text="Уберите сюда неактуальные объявления: жители перестанут их видеть." />
        : <Empty icon="megaphone" title="Актуальных объявлений нет" text="Отправьте объявление жителям — оно появится здесь." />}
    </Page>
  );
}

// A one-time invitation of a company employee: send it in MAX or copy the
// text with the link and paste it anywhere.
export function InviteResult({ invite, companyName }: { invite: Invite; companyName?: string }) {
  const { showSnackbar } = useSnackbar();
  // Only the link: it is sent or pasted as it is.
  const share = async () => {
    const result = await bridge.share(invite.link ?? '');
    if (result === 'copied') showSnackbar({ text: 'Ссылка скопирована' });
  };
  const copy = async () => {
    const copied = await bridge.copy(invite.link ?? '');
    bridge.haptic(copied ? 'success' : 'error');
    showSnackbar({ text: copied ? 'Ссылка скопирована' : 'Не удалось скопировать. Выделите ссылку и скопируйте вручную.' });
  };
  return (
    <div className="hero-card">
      <Typography.Body variant="medium">{invite.link ? `Одноразовая ссылка${companyName ? ` для «${companyName}»` : ''}, действует до ${formatDate(invite.expiresAt)}: кто откроет её в MAX, станет сотрудником этой УК.` : 'Ссылка не создана: в настройках сервера не указан ник бота (MAX_BOT_USERNAME).'}</Typography.Body>
      {invite.link ? <code className="code-line">{invite.link}</code> : <code className="code-line">startapp={invite.startParam}</code>}
      {invite.link ? (
        <div className="button-pair">
          <Button size="large" stretched onClick={() => void share()}>Отправить</Button>
          <Button size="large" variant="secondary" stretched onClick={() => void copy()}>Скопировать</Button>
        </div>
      ) : null}
    </div>
  );
}

export function DeskTeamScreen() {
  const team = useLoad(() => api.desk.team(), []);
  const { showSnackbar } = useSnackbar();
  const [invite, setInvite] = useState<Invite | null>(null);
  const create = async () => {
    try { setInvite(await api.desk.invite('supervisor')); } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  return (
    <Page title="Команда УК">
      {team.data ? (
        <Section header="Сотрудники">
          {team.data.map((member) => <CellSimple key={member.id} title={member.displayName ?? member.username} subtitle={`${roleLabels[member.role]}, ${member.viaMax ? 'входит через MAX' : 'входит через веб-пульт'}`} />)}
        </Section>
      ) : team.error ? <Failure text={team.error} retry={team.reload} /> : <Loading />}
      <Actions>
        <Button size="large" stretched onClick={() => void create()}>Пригласить сотрудника</Button>
      </Actions>
      {invite ? <InviteResult invite={invite} /> : null}
    </Page>
  );
}

export function CompanyForm({ initial, submitLabel, onSubmit }: { initial: Partial<Company>; submitLabel: string; onSubmit: (company: Partial<Company>) => Promise<void> }) {
  const [form, setForm] = useState<Partial<Company>>({ ...initial, ...(initial.phone ? { phone: formatPhone(initial.phone) } : {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const point: Point | null = form.latitude != null && form.longitude != null ? { latitude: form.latitude, longitude: form.longitude } : null;
  const set = (key: keyof Company) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  // The office is found by its address when there is no point yet.
  const [locating, setLocating] = useState(false);
  const locateOffice = async (asked: boolean) => {
    const address = form.address?.trim();
    if (!address || address.length < 5) return;
    setLocating(true);
    try {
      const found = await api.geoLocate(address);
      setForm((current) => ({ ...current, ...found }));
    } catch {
      if (asked) setError('Адрес офиса не найден на карте. Поставьте точку нажатием на карту.');
    } finally { setLocating(false); }
  };
  useEffect(() => { if (!point && form.address?.trim()) void locateOffice(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await onSubmit(form); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  return (
    <div className="form">
      <Field label="Название"><Input maxLength={200} value={form.name ?? ''} onChange={set('name')} placeholder="ООО «УК Северная»" /></Field>
      <Field label="Телефон для жителей"><Input maxLength={40} inputMode="tel" value={form.phone ?? ''} onChange={set('phone')} onBlur={() => setForm((current) => ({ ...current, phone: formatPhone(current.phone ?? '') }))} placeholder="+7 (900) 000-00-00" /></Field>
      <Field label="ИНН" hint="10 или 12 цифр, необязательно"><Input inputMode="numeric" value={form.inn ?? ''} onChange={set('inn')} /></Field>
      <Field label="Email"><Input maxLength={200} type="email" value={form.email ?? ''} onChange={set('email')} /></Field>
      <Field label="Адрес офиса"><Input maxLength={300} value={form.address ?? ''} onChange={set('address')} /></Field>
      <Field label="Часы работы"><Input maxLength={300} value={form.workingHours ?? ''} onChange={set('workingHours')} placeholder="Пн–Пт 9:00–18:00" /></Field>
      <Field label="Приём граждан"><Input maxLength={300} value={form.receptionHours ?? ''} onChange={set('receptionHours')} placeholder="Вт 10:00–13:00, Чт 15:00–19:00" /></Field>
      <Field label="Выходные дни"><Input maxLength={200} value={form.daysOff ?? ''} onChange={set('daysOff')} placeholder="Сб, Вс, праздничные дни" /></Field>
      <Field label="Уборка и благоустройство" hint="Жители видят это в «Моя УК»: что и как часто убирается">
        <Textarea maxLength={1500} value={form.cleaningInfo ?? ''} onChange={set('cleaningInfo')} rows={3} placeholder="Влажная уборка подъездов — раз в неделю, двор — ежедневно" />
      </Field>
      <Field label="Офис на карте" hint={locating ? 'Ищем офис по адресу…' : 'Точка ставится по адресу офиса. Если она не там, нажмите на карту в нужном месте'}>
        <HouseMap houses={[]} pin={point} pinKind="office" onPick={(next) => setForm((current) => ({ ...current, ...next }))} height={220} {...(point ? { focus: point } : {})} />
        {form.address?.trim() ? <button type="button" className="link-button" disabled={locating} onClick={() => void locateOffice(true)}>Поставить точку по адресу</button> : null}
      </Field>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <Button size="large" stretched loading={busy} disabled={busy || !form.name?.trim() || !form.phone?.trim()} onClick={() => void submit()}>{submitLabel}</Button>
    </div>
  );
}

export function DeskCompanyScreen() {
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const overview = useLoad(() => api.desk.overview(), []);
  if (overview.error) return <Failure text={overview.error} retry={overview.reload} />;
  if (!overview.data) return <Loading />;
  const { company } = overview.data;
  return (
    <Page title="Карточка УК" subtitle="Эти контакты видят жители ваших домов">
      <CompanyForm initial={company} submitLabel="Сохранить" onSubmit={async (form) => {
        await api.desk.saveCompany(form);
        showSnackbar({ text: 'Сохранено' });
        navigation.back();
      }} />
    </Page>
  );
}

// Up to 30 houses matching the typed address; the chosen one stays on top.
export function HouseChoice({ houses, query, selected, onSelect }: {
  houses: Array<{ id: string; address: string; connectedApartments: number }>;
  query: string; selected: string; onSelect: (id: string) => void;
}) {
  const chosen = houses.find((house) => house.id === selected);
  const found = houses.filter((house) => house.id !== selected && (!query.trim() || addressMatches(house.address, query)));
  return (
    <Section header={query.trim() ? `Найдено: ${found.length}` : `Все дома: ${houses.length}`}>
      {chosen ? <CellSimple title={chosen.address} subtitle="Выбран" after="✓" /> : null}
      {found.slice(0, 30).map((house) => (
        <CellSimple key={house.id} as="button" onClick={() => onSelect(house.id)} title={house.address}
          subtitle={`${house.connectedApartments} ${plural(house.connectedApartments, 'квартира', 'квартиры', 'квартир')} в сервисе`} />
      ))}
      {found.length > 30 ? <CellSimple subtitle={`Ещё ${found.length - 30} — уточните адрес`} /> : null}
      {!found.length && !chosen ? <CellSimple subtitle="Такого дома нет. Проверьте улицу и номер." /> : null}
    </Section>
  );
}

// Emergencies first of all: a red block on top of the desk while any is open,
// to step in right away.
function EmergencyBlock() {
  const navigation = useNavigation();
  const list = useLoad(() => api.desk.incidents({ priority: 'emergency', sort: 'date_desc' }), []);
  const open = (list.data ?? []).filter((incident) => incident.status !== 'resolved' && incident.status !== 'rejected');
  if (!open.length) return null;
  return (
    <section className="emergency-block">
      <header className="emergency-head">
        <span className="emergency-title">Аварии: {open.length}</span>
        <span className="emergency-text">Нужно немедленное вмешательство</span>
      </header>
      {open.slice(0, 3).map((incident) => (
        <button key={incident.id} type="button" className="emergency-item" onClick={() => navigation.push({ name: 'desk-incident', id: incident.id })}>
          <span className="emergency-item-title">№ {incident.number}. {incident.title}</span>
          <span className="emergency-item-text">{incident.address}, {ago(incident.createdAt)}</span>
        </button>
      ))}
      {open.length > 3 ? <button type="button" className="link-button" onClick={() => navigation.push({ name: 'desk-incidents', status: 'emergency' })}>Все аварии</button> : null}
    </section>
  );
}

// Figures of the company: a screen of its own, the desk keeps the actions.
export function DeskStatsScreen() {
  const overview = useLoad(() => api.desk.overview(), []);
  if (overview.error) return <Failure text={overview.error} retry={overview.reload} />;
  if (!overview.data) return <Loading />;
  const { stats } = overview.data;
  return (
    <Page title="Показатели" subtitle={`За ${stats.periodDays} дней: ${stats.incidents} ${plural(stats.incidents, 'заявка', 'заявки', 'заявок')} от ${stats.reports} ${plural(stats.reports, 'жителя', 'жителей', 'жителей')}`}>
      <MetricsGrid stats={stats} />
      <Section header="В сервисе">
        <CellSimple title="Жителей подключено" after={<span className="muted">{stats.residents}</span>} />
        <CellSimple title="Домов на карте" after={<span className="muted">{stats.buildingsOnMap} из {stats.buildings}</span>} />
      </Section>
      {stats.topCategories.length ? (
        <Section header="Чаще всего за месяц">
          {stats.topCategories.map((item) => <CellSimple key={item.category} title={categoryLabels[item.category]} after={<span className="muted">{item.count}</span>} />)}
        </Section>
      ) : null}
    </Page>
  );
}

// Requests to join apartments where residents already live and did not answer.
export function DeskJoinsScreen() {
  const joins = useLoad(() => api.desk.joinRequests(), []);
  const { showSnackbar } = useSnackbar();
  if (joins.error) return <Failure text={joins.error} retry={joins.reload} />;
  if (!joins.data) return <Loading />;
  const decide = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await api.desk.decideJoin(id, decision);
      showSnackbar({ text: decision === 'approve' ? 'Житель подключён к квартире' : 'Запрос отклонён' });
      await joins.reload();
    } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  return (
    <Page title="Подключение к квартирам" subtitle="Жители квартиры не ответили на запрос — решите здесь">
      {joins.data.length ? (
        <Section>
          {joins.data.map((request) => (
            <CellSimple key={request.id} title={request.requesterName} subtitle={`${request.address}, кв. ${request.apartmentNumber}, ${ago(request.createdAt)}`}
              after={<span className="inline-actions"><Button size="small" onClick={() => void decide(request.id, 'approve')}>Принять</Button><Button size="small" variant="secondary" onClick={() => void decide(request.id, 'reject')}>Нет</Button></span>} />
          ))}
        </Section>
      ) : <Empty icon="key" title="Запросов нет" text="Новые запросы появятся здесь, если жители квартиры не ответят." />}
    </Page>
  );
}
