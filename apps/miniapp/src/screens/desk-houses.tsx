import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { applyLookup, emptyHouse, houseBody, HouseFields, houseReady, useHouseLookup, type HouseValues } from '../components/HouseForm';
import { Button, CellAction, CellSimple, Input, Typography, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type DeskApartment, type DeskBuilding } from '../api';
import { bridge } from '../bridge';
import { useNavigation, useStepBack } from '../nav';
import { useLoad, useSession } from '../session';
import { HouseMap, type Point } from '../components/HouseMap';
import { AddressSearch } from '../components/AddressSearch';
import { Actions, Failure, Field, Loading, Page, Plate, Section, Sheet } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { plural, addressMatches } from '../labels';

// Houses of the company on the map: add a house by tapping its place, drag a
// pin to correct it, reveal the house code to print for residents, get the
// QR code for the entrance.

type Mode = { kind: 'view' } | { kind: 'add'; point: Point | null } | { kind: 'move'; id: string; point: Point };

export function DeskHousesScreen() {
  const { me } = useSession();
  const { showSnackbar } = useSnackbar();
  const houses = useLoad(() => api.desk.buildings(), []);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  // Adding or moving a house: "back" first leaves that mode.
  useStepBack(mode.kind !== 'view', () => setMode(mode.kind === 'add' && mode.point ? { kind: 'add', point: null } : { kind: 'view' }));
  const [selected, setSelected] = useState<string | null>(null);
  const [created, setCreated] = useState<{ address: string; code: string } | null>(null);
  const [view, setView] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);

  const all = houses.data ?? [];
  const [listQuery, setListQuery] = useState('');
  const listed = listQuery.trim() ? all.filter((item) => addressMatches(item.address, listQuery)) : all;
  const onMap = useMemo(() => all
    .filter((house) => house.latitude !== null && house.longitude !== null && !(mode.kind === 'move' && mode.id === house.id))
    .map((house) => ({ id: house.id, latitude: house.latitude!, longitude: house.longitude!, openIssues: house.openIncidents, label: house.address, selected: house.id === selected })), [all, selected, mode]);
  const withoutPoint = all.filter((house) => house.latitude === null);
  const house = all.find((item) => item.id === selected) ?? null;

  if (houses.error) return <Failure text={houses.error} retry={houses.reload} />;
  if (!houses.data) return <Loading />;

  const saveMove = async () => {
    if (mode.kind !== 'move') return;
    try {
      await api.desk.moveBuilding(mode.id, mode.point);
      bridge.haptic('success');
      showSnackbar({ text: 'Точка дома сохранена' });
      setMode({ kind: 'view' });
      await houses.reload();
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    }
  };

  return (
    <Page title="Дома УК" subtitle={`${all.length} ${plural(all.length, 'дом', 'дома', 'домов')}, на карте ${all.length - withoutPoint.length}`}
      after={mode.kind === 'view' ? <Button size="small" onClick={() => { setSelected(null); setMode({ kind: 'add', point: null }); }}>+ Дом</Button> : undefined}>

      {mode.kind === 'move' ? <div className="insight">Нажмите на карте новое место дома — метка переместится туда.</div> : null}
      {mode.kind === 'add' ? (
          <AddressSearch
            onCity={(city) => setView({ latitude: city.latitude, longitude: city.longitude, zoom: 13 })}
            onAddress={(address) => {
              if (address.house) setMode({ kind: 'add', point: { latitude: address.latitude, longitude: address.longitude } });
              else setView({ latitude: address.latitude, longitude: address.longitude, zoom: 17 });
            }}
          />
      ) : null}
      <HouseMap legend
        houses={onMap}
        onHouse={mode.kind === 'view' ? setSelected : undefined}
        {...(mode.kind === 'add' ? { onPick: (point: Point) => setMode({ kind: 'add', point }), pin: mode.point } : {})}
        {...(mode.kind === 'move' ? { onPick: (point: Point) => setMode({ ...mode, point }), pin: mode.point } : {})}
        height={mode.kind === 'view' ? '44vh' : '42vh'}
        fill={mode.kind === 'add' && !mode.point}
        expandable
        focusZoom={mode.kind === 'view' ? 16 : 18}
        view={view}
        {...(mode.kind === 'add' && mode.point ? { focus: mode.point } : {})}
      />
      {mode.kind === 'move' ? (
        <Actions>
          <Button size="large" stretched onClick={() => void saveMove()}>Сохранить точку</Button>
          <Button size="large" variant="ghost" stretched onClick={() => setMode({ kind: 'view' })}>Отмена</Button>
        </Actions>
      ) : null}
      {mode.kind === 'add' && mode.point ? (
        <NewHouseForm point={mode.point} onCancel={() => setMode({ kind: 'view' })} onCreated={async (address, code) => { setMode({ kind: 'view' }); setCreated({ address, code }); await houses.reload(); }} />
      ) : null}
      {mode.kind === 'add' && !mode.point ? <Actions><Button size="medium" variant="ghost" onClick={() => setMode({ kind: 'view' })}>Отмена</Button></Actions> : null}

      {mode.kind === 'view' ? (
        <>
          <Input maxLength={100} value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Найти дом: улица и номер" withClearButton />
          <Section header={listQuery.trim() ? `Найдено: ${listed.length}` : `Все дома: ${all.length}`}>
            {listed.slice(0, 40).map((item) => (
              <CellSimple key={item.id} as="button" onClick={() => setSelected(item.id)} title={item.address}
                subtitle={`${item.latitude === null ? 'нет точки на карте, ' : ''}открыто ${item.openIncidents}, в сервисе ${item.connectedApartments} из ${item.apartmentsCount} кв.`} showChevron />
            ))}
            {listed.length > 40 ? <CellSimple subtitle={`Ещё ${listed.length - 40} — уточните адрес`} /> : null}
            {!listed.length ? <CellSimple subtitle="Такого дома нет. Проверьте улицу и номер." /> : null}
          </Section>
        </>
      ) : null}

      <Sheet open={Boolean(house)} onClose={() => setSelected(null)} title="Дом">
        {house ? <HouseSheet house={house} canSeeCode={me.admin?.role !== 'dispatcher'} isPlatform={me.admin?.role === 'platform_admin'}
          onMove={() => { setSelected(null); setMode({ kind: 'move', id: house.id, point: house.latitude !== null ? { latitude: house.latitude, longitude: house.longitude! } : onMap[0] ?? { latitude: 56.8389, longitude: 60.6057 } }); }}
          onChanged={() => { setSelected(null); void houses.reload(); }} /> : null}
      </Sheet>
      <Sheet open={Boolean(created)} onClose={() => setCreated(null)} title="Дом добавлен">
        {created ? <CodeCard address={created.address} code={created.code} /> : null}
      </Sheet>
    </Page>
  );
}

function CodeCard({ buildingId, address, code: initial, onBack }: { buildingId?: string; address: string; code: string; onBack?: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [code, setCode] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const pretty = `${code.slice(0, 3)} ${code.slice(3, 6)} ${code.slice(6)}`;
  const save = async () => {
    try {
      if (!buildingId) return;
      const result = await api.desk.setBuildingCode(buildingId, draft.replace(/\s/g, ''));
      setCode(result.code);
      setEditing(false);
      bridge.haptic('success');
      showSnackbar({ text: 'Код дома изменён. Старый код больше не подходит.' });
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    }
  };
  return (
    <div className="sheet">
      {onBack ? <button type="button" className="back-link" onClick={onBack}>‹ Назад к дому</button> : null}
      <Typography.Body variant="small" className="muted">{address}</Typography.Body>
      <div className="code-plate"><Plate size="large">{pretty}</Plate></div>
      <Typography.Body variant="small" className="muted">Код дома нужен жителям, чтобы подтвердить квартиру. Разместите его на доске объявлений или в чате дома.</Typography.Body>
      <Button size="large" stretched onClick={async () => {
        const result = await bridge.share(`Код дома ${address} для подключения к сервису «Домовед» в MAX: ${pretty}`);
        if (result === 'copied') showSnackbar({ text: 'Код скопирован' });
      }}>Поделиться кодом</Button>
      {editing ? (
        <div className="form">
          <Field label="Новый код дома" hint="Ровно 10 цифр. Жители, которые уже подключены, останутся в сервисе.">
            <Input inputMode="numeric" maxLength={13} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="1234567890" />
          </Field>
          <Button size="large" stretched disabled={draft.replace(/\s/g, '').length !== 10} onClick={() => void save()}>Сохранить код</Button>
          <Button size="medium" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
        </div>
      ) : buildingId ? <Button size="large" variant="secondary" stretched onClick={() => { setDraft(''); setEditing(true); }}>Изменить код</Button> : null}
    </div>
  );
}

function HouseSheet({ house, canSeeCode, isPlatform, onMove, onChanged }: { house: DeskBuilding; canSeeCode: boolean; isPlatform: boolean; onMove: () => void; onChanged: () => void }) {
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const [code, setCode] = useState<string | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [qr, setQr] = useState(false);
  const reveal = async () => {
    try { setCode(await api.desk.buildingCode(house.id)); } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  if (code) return <CodeCard buildingId={house.id} address={house.address} code={code} onBack={() => setCode(null)} />;
  if (qr) return <HouseQrCard house={house} onBack={() => setQr(false)} />;
  if (transfer) return <TransferForm house={house} onDone={onChanged} onBack={() => setTransfer(false)} />;
  return (
    <div className="sheet">
      <Typography.Title variant="medium-strong">{house.address}</Typography.Title>
      <Typography.Body variant="small" className="muted">{house.entrancesCount} подъезд., {house.apartmentsCount} кв., в сервисе {house.connectedApartments}</Typography.Body>
      <ChatLinkCard house={house} onSaved={onChanged} />
      <Section>
        <CellAction onClick={() => navigation.push({ name: 'desk-incidents' })} showChevron>Открытые заявки: {house.openIncidents}</CellAction>
        <CellAction onClick={() => navigation.push({ name: 'desk-broadcast', buildingId: house.id })} showChevron>Объявление этому дому</CellAction>
        <CellAction onClick={() => setQr(true)} showChevron>QR-код для подъезда</CellAction>
        <CellAction onClick={onMove} showChevron>{house.latitude === null ? 'Поставить на карту' : 'Переместить точку'}</CellAction>
        {canSeeCode ? <CellAction onClick={() => void reveal()} showChevron>Код дома: показать или изменить</CellAction> : null}
        <CellAction onClick={() => navigation.push({ name: 'desk-apartments', buildingId: house.id, address: house.address })} showChevron>Квартиры: коды и договоры</CellAction>
        {isPlatform ? <CellAction mode="destructive" onClick={() => setTransfer(true)} showChevron>Передать другой УК</CellAction> : null}
      </Section>
    </div>
  );
}

// The QR code at the entrance: the bot opens with this house chosen, the
// resident types the apartment and proves it with the code or the contract.
// The code itself gives no access, so any staff member may show it.
function HouseQrCard({ house, onBack }: { house: DeskBuilding; onBack: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [link, setLink] = useState<string | null>(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.desk.residentLink(house.id).then(async (value) => {
      const image = await QRCode.toString(value.link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
      if (alive) { setLink(value.link); setSvg(image); }
    }).catch((failure: unknown) => { if (alive) setError(errorText(failure)); });
    return () => { alive = false; };
  }, [house.id]);
  // The printable poster lives in the web desk: a phone webview cannot print.
  const openWeb = async () => {
    try { bridge.openLink((await api.desk.webLink()).url); } catch (failure) { showSnackbar({ text: errorText(failure) }); }
  };
  return (
    <div className="sheet">
      <button type="button" className="back-link" onClick={onBack}>‹ Назад к дому</button>
      <Typography.Title variant="medium-strong">QR-код для подъезда</Typography.Title>
      <Typography.Body variant="small" className="muted">{house.address}</Typography.Body>
      {error ? <div className="form-error" role="alert">{error}</div> : svg ? <div className="qr-preview" role="img" aria-label={`QR-код дома ${house.address}`} dangerouslySetInnerHTML={{ __html: svg }} /> : <Loading />}
      <Typography.Body variant="small" className="muted">Житель наводит камеру — открывается бот «Домовед» в MAX, где этот дом уже выбран. Остаётся указать квартиру и подтвердить её кодом дома или номером договора. Сам QR-код доступа к квартире не даёт.</Typography.Body>
      {link ? <span className="info-card-text chat-card-link">{link}</span> : null}
      <Button size="large" stretched disabled={!link} onClick={async () => {
        if (!link) return;
        const result = await bridge.share(`Подключите квартиру ${house.address} к «Домоведу» в MAX: заявки в УК, объявления и опросы дома.`, link);
        if (result === 'copied') showSnackbar({ text: 'Ссылка скопирована' });
        if (result === 'failed') showSnackbar({ text: 'Не удалось поделиться ссылкой' });
      }}>Поделиться ссылкой</Button>
      <Button size="large" variant="secondary" stretched disabled={!link} onClick={async () => { if (link) showSnackbar({ text: (await bridge.copy(link)) ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку' }); }}>Скопировать ссылку</Button>
      <Button size="medium" variant="ghost" stretched onClick={() => void openWeb()}>Листовка для печати — в веб-пульте</Button>
    </div>
  );
}

function TransferForm({ house, onDone, onBack }: { house: DeskBuilding; onDone: () => void; onBack: () => void }) {
  const { showSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const overview = useLoad(() => api.platform.overview(), []);
  const { acting } = useSession();
  if (!overview.data) return <Loading />;
  return (
    <div className="sheet">
      <button type="button" className="back-link" onClick={onBack}>‹ Назад к дому</button>
      <Typography.Body variant="small" className="muted">Например, собственники выбрали другую УК на общем собрании. Жители и история заявок останутся у дома, новые заявки увидит новая УК.</Typography.Body>
      <Section header={`Кому передать ${house.address}`}>
        {overview.data.companies.filter((company) => company.id !== acting?.id).map((company) => (
          <CellSimple key={company.id} as="button" title={company.name} showChevron onClick={async () => {
            if (!await confirm({ text: `Передать дом ${house.address} в «${company.name}»? Жители и история заявок останутся у дома.`, confirm: 'Передать' })) return;
            try { await api.platform.transfer(house.id, company.id); showSnackbar({ text: 'Дом передан' }); onDone(); } catch (error) { showSnackbar({ text: errorText(error) }); }
          }} />
        ))}
      </Section>
    </div>
  );
}

function NewHouseForm({ point, onCancel, onCreated }: { point: Point; onCancel: () => void; onCreated: (address: string, code: string) => Promise<void> }) {
  const { lookup, loading } = useHouseLookup(point);
  const [values, setValues] = useState<HouseValues>(emptyHouse);
  const [touched, setTouched] = useState<Set<keyof HouseValues>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recognised values fill the fields the person has not typed into yet.
  useEffect(() => { setValues((current) => applyLookup(current, lookup, touched)); }, [lookup]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.desk.createBuilding(houseBody(values, point));
      bridge.haptic('success');
      await onCreated(result.item.address, result.accessCode);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form">
      <HouseFields values={values} lookup={lookup} loading={loading} onChange={(next, field) => { setValues(next); setTouched((current) => new Set(current).add(field)); }} />
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <Button size="large" stretched loading={busy} disabled={!houseReady(values) || busy || Boolean(lookup?.existing)} onClick={() => void submit()}>Добавить дом</Button>
      <Button size="medium" variant="ghost" onClick={onCancel}>Отмена</Button>
    </div>
  );
}

// Apartments of a house: hundreds of them, so they are found by the number.
// The company sets a personal apartment code and the contract number here.
export function DeskApartmentsScreen({ buildingId, address }: { buildingId: string; address: string }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DeskApartment[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  // A portion of 30 after the ones shown; a new search starts from the top.
  const load = async (reset: boolean) => {
    const current = generation.current;
    setLoading(true);
    try {
      const page = await api.desk.apartments(buildingId, query.trim(), reset ? 0 : items.length);
      if (current !== generation.current) return;
      setItems((shown) => (reset ? page.items : [...shown, ...page.items]));
      setTotal(page.total);
      setError(null);
    } catch (failure) {
      if (current === generation.current) setError(errorText(failure));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    generation.current += 1;
    setItems([]);
    setTotal(null);
    const timer = setTimeout(() => void load(true), 200);
    return () => clearTimeout(timer);
  }, [buildingId, query]); // eslint-disable-line react-hooks/exhaustive-deps

  // More apartments as the end of the list comes into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || total === null || items.length >= total) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !loading) void load(false);
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, total, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { generation.current += 1; void load(true); };
  return (
    <Page title="Квартиры и коды" subtitle={address}>
      <Input maxLength={200} inputMode="numeric" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер квартиры" withClearButton />
      {error ? <Failure text={error} retry={refresh} /> : total === null ? <Loading /> : (
        <Section header={query.trim() ? `Найдено: ${total}` : `Всего квартир: ${total}`}>
          {items.map((apartment) => (
            open === apartment.id
              ? <ApartmentCodes key={apartment.id} apartment={apartment} onDone={() => { setOpen(null); refresh(); }} />
              : <CellSimple key={apartment.id} as="button" onClick={() => setOpen(apartment.id)} title={`Квартира ${apartment.number}`}
                  subtitle={`${apartment.people.length ? apartment.people.join('; ') : 'никто не подключён'}; ${apartment.hasCode ? 'личный код задан' : 'без личного кода'}; договор ${apartment.contractNumber}`} showChevron />
          ))}
          {!items.length ? <CellSimple subtitle="Такой квартиры нет в доме." /> : null}
        </Section>
      )}
      <div ref={sentinel} />
      {loading && items.length ? <Loading /> : null}
    </Page>
  );
}

function ApartmentCodes({ apartment, onDone }: { apartment: DeskApartment; onDone: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [code, setCode] = useState('');
  const [contract, setContract] = useState(apartment.contractNumber);
  const [busy, setBusy] = useState(false);
  const save = async (body: { code?: string | null; contractNumber?: string }, done: string) => {
    setBusy(true);
    try { await api.desk.setApartmentCodes(apartment.id, body); bridge.haptic('success'); showSnackbar({ text: done }); onDone(); }
    catch (error) { showSnackbar({ text: errorText(error) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="apartment-codes">
      <span className="info-card-title">Квартира {apartment.number}</span>
      <div className="apartment-people">
        <span className="form-label">Зарегистрированы в сервисе</span>
        {apartment.people.length ? apartment.people.map((person) => <span key={person} className="apartment-person">{person}</span>) : <span className="apartment-person muted">Пока никого</span>}
      </div>
      <Field label="Личный код квартиры" hint={apartment.hasCode ? 'Код задан. Новый заменит старый — его увидит только тот, кому вы его дадите.' : 'Без кода к квартире подключаются по коду дома и подтверждению соседей.'}>
        <Input maxLength={64} value={code} onChange={(event) => setCode(event.target.value)} placeholder="От 6 символов" />
      </Field>
      <Button size="medium" stretched disabled={code.trim().length < 6 || busy} onClick={() => void save({ code: code.trim() }, 'Код квартиры сохранён')}>Сохранить код</Button>
      {apartment.hasCode ? <Button size="medium" variant="secondary" stretched disabled={busy} onClick={() => void save({ code: null }, 'Личный код убран')}>Убрать личный код</Button> : null}
      <Field label="Номер договора" hint="От 4 до 30 символов: цифры, буквы и «/», обычно 10 цифр. По нему житель подключается сразу, без кодов.">
        <Input maxLength={30} value={contract} onChange={(event) => setContract(event.target.value)} />
      </Field>
      <Button size="medium" stretched disabled={contract.trim() === apartment.contractNumber || busy} onClick={() => void save({ contractNumber: contract.trim() }, 'Номер договора сохранён')}>Сохранить договор</Button>
      <Button size="medium" variant="ghost" onClick={onDone}>Закрыть</Button>
    </div>
  );
}

// The chat of the house in MAX, right in the house card: residents get a
// "Чат дома" button in the app and in the bot.
function ChatLinkCard({ house, onSaved }: { house: DeskBuilding; onSaved: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [editing, setEditing] = useState(!house.chatLink);
  const [link, setLink] = useState(house.chatLink ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await api.desk.setChatLink(house.id, value);
      bridge.haptic('success');
      showSnackbar({ text: value ? 'Чат дома добавлен: жители увидят кнопку «Чат дома»' : 'Ссылка на чат убрана' });
      onSaved();
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chat-card">
      <span className="info-card-title">Чат дома</span>
      {editing ? (
        <>
          <span className="info-card-text">Создайте чат в MAX, откройте его настройки и скопируйте ссылку-приглашение.</span>
          <Input maxLength={300} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://max.ru/join/…" />
          <Button size="medium" stretched loading={busy} disabled={link.trim().length < 10 || busy} onClick={() => void save(link.trim())}>Сохранить ссылку</Button>
        </>
      ) : (
        <>
          <span className="info-card-text chat-card-link">{house.chatLink}</span>
          <div className="button-pair">
            <Button size="medium" variant="secondary" onClick={() => setEditing(true)}>Изменить</Button>
            <Button size="medium" variant="secondary" disabled={busy} onClick={() => void save(null)}>Убрать</Button>
          </div>
        </>
      )}
    </div>
  );
}
