import { useEffect, useMemo, useState } from 'react';
import { Button, CellSimple, Input, Textarea, useSnackbar } from '@maxhub/max-ui';
import { actAsCompany, api, ApiError, errorText, type CitySuggestion, type Invite, type RegistryCompany } from '../api';
import { bridge } from '../bridge';
import { useNavigation, useStepBack } from '../nav';
import { useLoad, useSession } from '../session';
import { useSearch } from '../search';
import { companyColor, HouseMap, type Point } from '../components/HouseMap';
import { AddressSearch } from '../components/AddressSearch';
import { Actions, Field, Page, Section } from '../components/ui';
import { distance, formatPhone, plural } from '../labels';
import { InviteResult } from './desk';

// A management company and all its houses at once. Open data do not say which
// houses a company manages (that is only in the closed ГИС ЖКХ), so the list
// comes from the company itself — usually its site has "дома в управлении".
// Each address is recognised like a tap on the map: the point, floors, flats
// and year from OpenStreetMap and the open registry; what is missing is typed in.

type Company = { id: string | null; name: string; phone: string; inn: string | null; ogrn: string | null; email: string | null; site: string | null; address: string | null };

type Row = {
  key: string;
  source: string;
  status: 'ready' | 'needs' | 'exists' | 'missing' | 'added' | 'failed';
  note?: string;
  street: string;
  house: string;
  apartments: string;
  entrances: string;
  point: Point | null;
  floors: number | null;
  builtYear: number | null;
  fiasGuid: string | null;
  city?: string | null;
};

const maxRows = 40;

function companyFrom(item: RegistryCompany): Company {
  return {
    id: item.connectedCompanyId, name: item.nameShort || item.nameFull, phone: formatPhone(item.phone ?? ''), inn: item.inn, ogrn: item.ogrn,
    email: item.email, site: item.site, address: item.actualAddress || item.legalAddress,
  };
}

// About four flats on a floor of one entrance: a starting value to correct.
function estimateEntrances(apartments: number, floors: number | null) {
  return String(Math.max(1, Math.round(apartments / Math.max(1, (floors ?? 5) * 4))));
}

function sameHouse(left: Row, right: Row) {
  const fold = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[\s.,]/g, '');
  return Boolean(left.street && left.house) && fold(left.street) === fold(right.street) && fold(left.house) === fold(right.house);
}

async function recognise(point: Point, source: string): Promise<Row> {
  const lookup = await api.lookup(point);
  const apartments = lookup.details.apartments ?? null;
  const row: Row = {
    key: `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`,
    source,
    status: 'ready',
    street: lookup.address?.street ?? '',
    house: lookup.address?.house ?? '',
    apartments: apartments ? String(apartments) : '',
    entrances: apartments ? estimateEntrances(apartments, lookup.details.floors) : '',
    point,
    floors: lookup.details.floors,
    builtYear: lookup.details.builtYear,
    fiasGuid: lookup.details.fiasGuid,
    city: lookup.address?.locality ?? null,
  };
  if (lookup.existing) return { ...row, status: 'exists', note: `уже в сервисе, УК «${lookup.existing.company.name}»` };
  if (!row.street || !row.house) return { ...row, status: 'missing', note: 'здание не распознано как жилой дом' };
  if (!apartments) return { ...row, status: 'needs', note: 'укажите число квартир и подъездов' };
  return row;
}

export function PlatformBulkScreen({ companyId }: { companyId?: string }) {
  const navigation = useNavigation();
  const { acting } = useSession();
  const { showSnackbar } = useSnackbar();
  const overview = useLoad(() => api.platform.overview(), []);
  const map = useLoad(() => api.map(), []);
  const preset = overview.data?.companies.find((item) => item.id === companyId) ?? null;

  const [company, setCompany] = useState<Company | null>(null);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<CitySuggestion | null>(null);
  const [view, setView] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null);
  const [finished, setFinished] = useState<{ companyId: string; name: string; added: number } | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);

  const chosen = company ?? (preset ? { id: preset.id, name: preset.name, phone: preset.phone, inn: preset.inn ?? null, ogrn: preset.ogrn ?? null, email: preset.email ?? null, site: preset.site ?? null, address: preset.address ?? null } : null);
  const registry = useSearch('bulk-registry', chosen ? '' : query, (value) => api.registryCompanies(value, city?.region ?? null).then((items) => (items.length || !city?.region ? items : api.registryCompanies(value))));
  useStepBack(Boolean(company) && !finished && !progress, () => { setCompany(null); setRows([]); });

  // The map moves to the office of the chosen company: its point if it is
  // connected, otherwise found by the address from the registry.
  useEffect(() => {
    if (!chosen) return;
    const connected = chosen.id ? overview.data?.companies.find((item) => item.id === chosen.id) : null;
    if (connected?.latitude != null && connected.longitude != null) { setView({ latitude: connected.latitude, longitude: connected.longitude, zoom: 14 }); return; }
    if (!chosen.address) return;
    void api.geoLocate(chosen.address).then((point) => setView({ ...point, zoom: 14 })).catch(() => undefined);
  }, [chosen?.id, chosen?.address, Boolean(overview.data)]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = progress !== null;
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length >= 3);
  const ready = rows.filter((row) => row.status === 'ready');

  // One house is in the list once: the same street and number twice is the same house.
  const append = (next: Row) => {
    setRows((current) => (current.some((row) => row.key === next.key || sameHouse(row, next)) ? current : [...current, next]));
    setLastKey(next.key);
    setTimeout(() => setLastKey((key) => (key === next.key ? null : key)), 2500);
  };
  const update = (key: string, patch: Partial<Row>) => setRows((current) => current.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...patch };
    if (next.status === 'needs' && Number(next.apartments) >= 1 && Number(next.entrances) >= 1) next.status = 'ready';
    if (next.status === 'ready' && !(Number(next.apartments) >= 1 && Number(next.entrances) >= 1)) next.status = 'needs';
    return next;
  }));

  // Addresses one by one: the geocoder allows about one request a second.
  const recogniseList = async () => {
    if (!city) { showSnackbar({ text: 'Сначала выберите город.' }); return; }
    const todo = lines.slice(0, maxRows - rows.length);
    for (const [index, line] of todo.entries()) {
      setProgress({ done: index, total: todo.length, what: line });
      try {
        const found = await api.geoResolve(line, city);
        if (!found.house) { append({ key: `line:${line}`, source: line, status: 'missing', note: `в городе ${city.name} есть только улица «${found.street}», такого дома нет — проверьте номер или город`, street: found.street, house: '', apartments: '', entrances: '', point: null, floors: null, builtYear: null, fiasGuid: null }); continue; }
        append(await recognise({ latitude: found.latitude, longitude: found.longitude }, line));
      } catch (error) {
        append({ key: `line:${line}`, source: line, status: 'missing', note: error instanceof ApiError && error.status === 404 ? `в городе ${city.name} такой адрес не найден` : errorText(error), street: '', house: '', apartments: '', entrances: '', point: null, floors: null, builtYear: null, fiasGuid: null });
      }
    }
    setProgress(null);
    setText('');
  };

  // A tap on a house already marked takes the mark off instead of adding it again.
  const unmark = (found: Row) => {
    setRows((current) => current.filter((row) => row.key !== found.key));
    showSnackbar({ text: `${[found.street, found.house].filter(Boolean).join(', ') || 'Дом'} убран из списка` });
  };
  const addPoint = async (point: Point) => {
    if (busy) return;
    const near = rows.find((row) => row.status !== 'added' && row.point && distance(row.point, point) < 15);
    if (near) { unmark(near); return; }
    setProgress({ done: 0, total: 1, what: 'дом на карте' });
    try {
      const next = await recognise(point, 'с карты');
      const same = rows.find((row) => row.status !== 'added' && sameHouse(row, next));
      if (same) unmark(same); else append(next);
    } catch (error) { showSnackbar({ text: errorText(error) }); }
    setProgress(null);
  };

  const connect = async () => {
    if (!chosen) return;
    setProgress({ done: 0, total: ready.length, what: 'управляющая компания' });
    try {
      const id = chosen.id ?? (await api.platform.createCompany({
        name: chosen.name.trim(), phone: chosen.phone.trim(), inn: chosen.inn, ogrn: chosen.ogrn, email: chosen.email, site: chosen.site, address: chosen.address,
      })).id;
      if (!chosen.id) setCompany({ ...chosen, id });
      actAsCompany(id);
      let added = 0;
      try {
        for (const [index, row] of ready.entries()) {
          setProgress({ done: index, total: ready.length, what: `${row.street}, ${row.house}` });
          try {
            await api.desk.createBuilding({
              street: row.street.trim(), house: row.house.trim(), apartmentsCount: Number(row.apartments), entrancesCount: Number(row.entrances),
              ...row.point!, fiasGuid: row.fiasGuid, floors: row.floors, builtYear: row.builtYear, city: row.city ?? city?.name ?? null,
            });
            added += 1;
            update(row.key, { status: 'added', note: '' });
          } catch (error) {
            update(row.key, { status: 'failed', note: errorText(error) });
          }
        }
      } finally {
        actAsCompany(acting?.id ?? null);
      }
      bridge.haptic('success');
      setFinished({ companyId: id, name: chosen.name, added });
      await map.reload();
    } catch (error) {
      bridge.haptic('error');
      showSnackbar({ text: errorText(error) });
    } finally {
      setProgress(null);
    }
  };

  // Houses in the service, and the houses of this list on top of them: the
  // list is highlighted, the last one added is picked out for a moment.
  const [lastKey, setLastKey] = useState<string | null>(null);
  const houses = useMemo(() => [
    ...(map.data?.buildings ?? []).filter((house) => house.latitude !== null).map((house) => ({
      id: house.id, latitude: house.latitude!, longitude: house.longitude!, openIssues: house.openIssues, label: house.address, companyId: house.companyId,
      highlighted: Boolean(chosen?.id) && house.companyId === chosen?.id,
      muted: Boolean(chosen?.id) && house.companyId !== chosen?.id,
    })),
  ], [map.data, chosen?.id]);
  const pending = rows.filter((row) => row.point && row.status !== 'missing' && row.status !== 'added')
    .map((row) => ({ ...row.point!, latest: row.key === lastKey }));

  if (finished) {
    return (
      <Page title="Дома подключены" subtitle={finished.name}>
        <div className="info-card">
          <span className="info-card-title">{finished.added} {plural(finished.added, 'дом подключён', 'дома подключены', 'домов подключено')}</span>
          <span className="info-card-text">У новых домов код 0000000000, у квартир 000000. Коды меняются в пульте УК.</span>
        </div>
        <RowsList rows={rows} />
        {invite ? <InviteResult invite={invite} companyName={finished.name} /> : null}
        <Actions>
          {invite ? null : <Button size="large" stretched onClick={async () => { try { setInvite(await api.platform.invite(finished.companyId, 'supervisor')); } catch (error) { showSnackbar({ text: errorText(error) }); } }}>Пригласить администратора УК</Button>}
          <Button size="large" variant="secondary" stretched onClick={() => navigation.replace({ name: 'platform-company', companyId: finished.companyId })}>Открыть карточку УК</Button>
        </Actions>
      </Page>
    );
  }

  return (
    <Page title="УК и её дома" subtitle="Подключение списком">
      <Section header="1. Управляющая компания">
        {chosen ? (
          <CellSimple
            before={<i className="company-swatch" style={{ background: chosen.id ? companyColor(chosen.id) : '#8a8f98' }} />}
            title={chosen.name}
            subtitle={chosen.id ? 'Уже в сервисе — дома добавятся к ней' : [chosen.inn ? `ИНН ${chosen.inn}` : null, 'будет подключена'].filter(Boolean).join(', ')}
            {...(preset && !company ? {} : { after: <Button size="small" variant="secondary" disabled={busy} onClick={() => { setCompany(null); setRows([]); }}>Другая</Button> })}
          />
        ) : (
          <CellSimple subtitle="Найдите УК в реестре ФРТ по названию или ИНН. Если она уже в сервисе, дома добавятся к ней." />
        )}
      </Section>
      {!chosen ? (
        <div className="form">
          <Input maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или ИНН" withClearButton />
          {registry.loading ? <p className="suggestion-empty">Ищем в реестре…</p> : null}
          {registry.items.length ? (
            <Section>
              {registry.items.map((item) => (
                <CellSimple key={item.id} as="button" onClick={() => { setCompany(companyFrom(item)); setQuery(''); }} title={item.nameShort || item.nameFull}
                  subtitle={[item.inn ? `ИНН ${item.inn}` : null, item.housesCount ? `${item.housesCount} ${plural(item.housesCount, 'дом', 'дома', 'домов')} в управлении` : null, item.connectedCompanyId ? 'уже в сервисе' : null, item.subject].filter(Boolean).join(', ')}
                  showChevron />
              ))}
            </Section>
          ) : registry.done && query.trim().length >= 2 ? <p className="suggestion-empty">В реестре не нашлось. Проверьте написание или ИНН.</p> : null}
        </div>
      ) : null}

      {chosen && !chosen.id && !chosen.phone ? (
        <div className="form">
          <Field label="Телефон УК для жителей" hint="В реестре телефона нет — укажите">
            <Input maxLength={40} inputMode="tel" value={chosen.phone} onChange={(event) => setCompany({ ...chosen, phone: event.target.value })} onBlur={() => setCompany({ ...chosen, phone: formatPhone(chosen.phone) })} placeholder="+7 (900) 000-00-00" />
          </Field>
        </div>
      ) : null}

      {chosen ? (
        <>
          <Section header="2. Город и адреса домов">
            <CellSimple subtitle="Вставьте список домов УК — по одному адресу в строке, например с её сайта. Или нажимайте на дома на карте ниже." />
          </Section>
          <AddressSearch cityOnly hint="" onCity={(next) => { setCity(next); setView({ latitude: next.latitude, longitude: next.longitude, zoom: 13 }); }} />
          <div className="form">
            <Textarea maxLength={6000} value={text} rows={6} onChange={(event) => setText(event.target.value)} placeholder={'Ленина 12\nул. Мира, д. 5, корп. 2\nпр. Победы 238'} />
            <Button size="large" stretched disabled={!lines.length || !city || busy || rows.length >= maxRows} onClick={() => void recogniseList()}>
              {lines.length ? `Распознать ${lines.length} ${plural(lines.length, 'адрес', 'адреса', 'адресов')}` : 'Распознать адреса'}
            </Button>
          </div>
          <HouseMap houses={houses} pending={pending} legend onPick={(point) => void addPoint(point)} fill={false} height="40vh" expandable view={view} focusZoom={17} />
          {progress ? (
            <div className="progress-card" role="status">
              <span>Распознаём {progress.done + 1} из {progress.total}: {progress.what}</span>
              <span className="progress-bar"><i style={{ width: `${Math.round(((progress.done + 1) / progress.total) * 100)}%` }} /></span>
            </div>
          ) : null}
          {rows.length ? (
            <>
              <Section header={`3. Проверьте дома: ${ready.length} из ${rows.length} готовы`}>
                <CellSimple subtitle="Где не хватает данных, допишите квартиры и подъезды. Остальное подставлено из открытых данных." />
              </Section>
              <RowsList rows={rows} onChange={update} onRemove={(key) => setRows((current) => current.filter((row) => row.key !== key))} />
              <Actions>
                <Button size="large" stretched loading={busy} disabled={!ready.length || busy || (!chosen.id && chosen.phone.trim().length < 6)} onClick={() => void connect()}>
                  {chosen.id ? `Добавить ${ready.length} ${plural(ready.length, 'дом', 'дома', 'домов')} к УК` : `Подключить УК и ${ready.length} ${plural(ready.length, 'дом', 'дома', 'домов')}`}
                </Button>
              </Actions>
            </>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

const statusText: Record<Row['status'], string> = { ready: 'готов', needs: 'нужны данные', exists: 'уже в сервисе', missing: 'не найден', added: 'подключён', failed: 'ошибка' };

function RowsList({ rows, onChange, onRemove }: { rows: Row[]; onChange?: (key: string, patch: Partial<Row>) => void; onRemove?: (key: string) => void }) {
  return (
    <div className="bulk-list">
      {rows.map((row) => (
        <div key={row.key} className={`bulk-row bulk-${row.status}`}>
          <div className="bulk-row-head">
            <span className="bulk-row-title">{row.street && row.house ? `${row.street}, ${row.house}` : row.source}</span>
            <span className="bulk-row-status">{statusText[row.status]}</span>
          </div>
          <span className="bulk-row-note">
            {[row.city ?? null, row.source !== 'с карты' && row.street ? `из «${row.source}»` : row.source === 'с карты' ? 'отмечен на карте' : null,
              row.floors ? `${row.floors} ${plural(row.floors, 'этаж', 'этажа', 'этажей')}` : null,
              row.builtYear ? `${row.builtYear} г.` : null, row.note].filter(Boolean).join(', ')}
          </span>
          {onChange && (row.status === 'ready' || row.status === 'needs') ? (
            <div className="form-row">
              <Field label="Квартир"><Input inputMode="numeric" value={row.apartments} onChange={(event) => onChange(row.key, { apartments: event.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Подъездов"><Input inputMode="numeric" value={row.entrances} onChange={(event) => onChange(row.key, { entrances: event.target.value.replace(/\D/g, '') })} /></Field>
            </div>
          ) : null}
          {onRemove && row.status !== 'added' ? <button type="button" className="link-button" onClick={() => onRemove(row.key)}>Убрать из списка</button> : null}
        </div>
      ))}
    </div>
  );
}
