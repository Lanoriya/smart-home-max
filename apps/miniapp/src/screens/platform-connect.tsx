import { useEffect, useMemo, useState } from 'react';
import { Button, CellSimple, Input, Typography, useSnackbar } from '@maxhub/max-ui';
import { actAsCompany, api, errorText, type Invite, type RegistryCompany } from '../api';
import { bridge } from '../bridge';
import { useNavigation, useStepBack } from '../nav';
import { useLoad, useSession } from '../session';
import { companyColor, HouseMap, type Point } from '../components/HouseMap';
import { AddressSearch } from '../components/AddressSearch';
import { applyLookup, emptyHouse, houseBody, HouseFields, houseReady, useHouseLookup, type HouseValues } from '../components/HouseForm';
import { Actions, Field, Page, Plate, Section } from '../components/ui';
import { useSearch } from '../search';
import { InviteResult } from './desk';
import { formatPhone, plural } from '../labels';

// Connecting a house and its management company from one tap on the map. The
// house is recognised by the map and the open registry; the company is found
// in the open registry of management companies by name or INN. Whatever was
// not found is typed in by hand.

type CompanyDraft = { name: string; phone: string; inn: string; ogrn: string; email: string; site: string; address: string };
const emptyCompany: CompanyDraft = { name: '', phone: '', inn: '', ogrn: '', email: '', site: '', address: '' };

function fromRegistry(item: RegistryCompany): CompanyDraft {
  return {
    name: item.nameShort || item.nameFull,
    phone: formatPhone(item.phone ?? ''),
    inn: item.inn ?? '',
    ogrn: item.ogrn ?? '',
    email: item.email ?? '',
    site: item.site ?? '',
    address: item.actualAddress || item.legalAddress || '',
  };
}

export function PlatformConnectScreen({ point: initialPoint }: { point?: Point }) {
  const navigation = useNavigation();
  const { acting } = useSession();
  const { showSnackbar } = useSnackbar();
  const [point, setPoint] = useState<Point | null>(initialPoint ?? null);
  const [view, setView] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);
  const { lookup, loading } = useHouseLookup(point);
  const map = useLoad(() => api.map(), []);
  // Houses already in the service, framed in the colour of their company; the
  // company chosen for the new house has its houses highlighted.
  const [chosenCompanyId, setChosenCompanyId] = useState<string | null>(null);
  const connected = (map.data?.buildings ?? []).filter((house) => house.latitude !== null)
    .map((house) => ({
      id: house.id, latitude: house.latitude!, longitude: house.longitude!, openIssues: house.openIssues, label: house.address, companyId: house.companyId,
      highlighted: Boolean(chosenCompanyId) && house.companyId === chosenCompanyId,
      muted: Boolean(chosenCompanyId) && house.companyId !== chosenCompanyId,
    }));
  const [house, setHouse] = useState<HouseValues>(emptyHouse);
  const [touched, setTouched] = useState<Set<keyof HouseValues>>(new Set());
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<RegistryCompany | null>(null);
  const [company, setCompany] = useState<CompanyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ companyId: string; companyName: string; address: string; code: string } | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  // "Back" first drops the chosen company, then the chosen house.
  useStepBack(!done && Boolean(point), () => {
    if (company) { setCompany(null); setChosen(null); return; }
    setPoint(null); setHouse(emptyHouse); setTouched(new Set());
  });

  useEffect(() => { setHouse((current) => applyLookup(current, lookup, touched)); }, [lookup]);
  useEffect(() => { setChosenCompanyId(chosen?.connectedCompanyId ?? null); }, [chosen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Registry search as the person types, within the region of the house first.
  const region = lookup?.address?.region ?? null;
  const registry = useSearch(`registry|${region}`, query, async (value) => {
    const items = await api.registryCompanies(value, region);
    return items.length || !region ? items : api.registryCompanies(value);
  });
  const results = registry.done || registry.items.length ? registry.items : null;

  // Who probably manages the tapped house: the company of the same house if it
  // is already in the service, otherwise the companies of connected houses
  // nearby. Open data do not say it directly, so a guess is marked as one.
  const nearby = useMemo(() => {
    if (!point || !map.data) return [] as Array<{ companyId: string; name: string; houses: number; metres: number }>;
    const byCompany = new Map<string, { companyId: string; name: string; houses: number; metres: number }>();
    for (const building of map.data.buildings) {
      if (building.latitude === null || building.longitude === null) continue;
      const metres = metresBetween(point, { latitude: building.latitude, longitude: building.longitude });
      if (metres > 250) continue;
      const name = map.data.companies.find((item) => item.id === building.companyId)?.name ?? '';
      const entry = byCompany.get(building.companyId) ?? { companyId: building.companyId, name, houses: 0, metres };
      entry.houses += 1;
      entry.metres = Math.min(entry.metres, metres);
      byCompany.set(building.companyId, entry);
    }
    return [...byCompany.values()].sort((left, right) => left.metres - right.metres);
  }, [point, map.data]);
  const [guessed, setGuessed] = useState(false);
  // A guess belongs to the tapped house: another house, another guess.
  useEffect(() => {
    if (guessed) { setCompany(null); setChosen(null); setGuessed(false); }
  }, [point?.latitude, point?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseConnected = (companyId: string, guess: boolean) => {
    const known = map.data?.companies.find((item) => item.id === companyId);
    if (!known) return;
    setChosen({
      id: `service:${companyId}`, subject: '', nameFull: known.name, nameShort: known.name, inn: known.inn ?? null, ogrn: known.ogrn ?? null,
      legalAddress: null, actualAddress: known.address ?? null, phone: known.phone, email: known.email ?? null, site: known.site ?? null,
      housesCount: null, connectedCompanyId: companyId,
    });
    setCompany({ ...emptyCompany, name: known.name, phone: known.phone });
    setGuessed(guess);
  };

  // Put the company in right away when it is known for sure (the house is in
  // the service) or when all connected houses around belong to one company.
  useEffect(() => {
    if (company || !lookup) return;
    if (lookup.existing) { chooseConnected(lookup.existing.company.id, false); return; }
    if (nearby.length === 1) chooseConnected(nearby[0]!.companyId, true);
  }, [lookup, nearby]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (item: RegistryCompany) => {
    setGuessed(false);
    setChosen(item);
    setCompany(fromRegistry(item));
    setQuery('');
  };

  const submit = async () => {
    if (!point || !company) return;
    setBusy(true);
    setError(null);
    try {
      const companyId = chosen?.connectedCompanyId ?? (await api.platform.createCompany({
        name: company.name.trim(), phone: company.phone.trim(), inn: company.inn.trim() || null, ogrn: company.ogrn.trim() || null,
        email: company.email.trim() || null, site: company.site.trim() || null, address: company.address.trim() || null,
      })).id;
      // The house is added as this company; then the desk returns to the
      // company the administrator had open.
      actAsCompany(companyId);
      try {
        const result = await api.desk.createBuilding(houseBody(house, point));
        bridge.haptic('success');
        setDone({ companyId, companyName: company.name.trim(), address: result.item.address, code: result.accessCode });
        // The new house appears on the map of this screen right away.
        void map.reload();
      } finally {
        actAsCompany(acting?.id ?? null);
      }
    } catch (failure) {
      bridge.haptic('error');
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const pretty = `${done.code.slice(0, 3)} ${done.code.slice(3, 6)} ${done.code.slice(6)}`;
    return (
      <Page title="Дом подключён" subtitle={`${done.address}, ${done.companyName}`}>
        <div className="hero-card done-card">
          <Typography.Body variant="small" className="muted">Код дома для жителей</Typography.Body>
          <Plate size="large">{pretty}</Plate>
          <Typography.Body variant="small" className="muted">Жители вводят его при подтверждении квартиры. Его можно разместить на доске объявлений или в чате дома.</Typography.Body>
        </div>
        {invite ? <InviteResult invite={invite} companyName={done.companyName} /> : null}
        <Actions>
          {invite ? null : (
            <Button size="large" stretched onClick={async () => { try { setInvite(await api.platform.invite(done.companyId, 'supervisor')); } catch (failure) { showSnackbar({ text: errorText(failure) }); } }}>Пригласить администратора УК</Button>
          )}
          <Button size="large" variant="secondary" stretched onClick={() => navigation.replace({ name: 'platform-company', companyId: done.companyId })}>Открыть карточку УК</Button>
          <Button size="medium" variant="ghost" onClick={() => { setDone(null); setInvite(null); setPoint(null); setHouse(emptyHouse); setTouched(new Set()); setChosen(null); setCompany(null); }}>Подключить ещё дом</Button>
        </Actions>
      </Page>
    );
  }

  const ready = Boolean(point && houseReady(house) && company && company.name.trim().length >= 2 && company.phone.trim().length >= 6 && !lookup?.existing);
  const setField = (field: keyof CompanyDraft) => (event: { target: { value: string } }) => setCompany((current) => ({ ...(current ?? emptyCompany), [field]: event.target.value }));

  return (
    <Page title="Подключить дом">
      <AddressSearch
        hint="Или нажмите на здание на карте. Цветом отмечены уже подключённые дома"
        onCity={(city) => setView({ latitude: city.latitude, longitude: city.longitude, zoom: 13 })}
        onAddress={(address) => {
          if (address.house) setPoint({ latitude: address.latitude, longitude: address.longitude });
          else setView({ latitude: address.latitude, longitude: address.longitude, zoom: 17 });
        }}
      />
      <HouseMap legend
        houses={connected} pin={point} onPick={setPoint}
        onHouse={(id) => { const house = map.data?.buildings.find((item) => item.id === id); if (house) navigation.push({ name: 'platform-company', companyId: house.companyId }); }}
        fill={!point} height="42vh" expandable focusZoom={18} view={view}
        {...(point ? { focus: point } : {})}
      />
      {point ? (
        <>
          <HouseFields values={house} lookup={lookup} loading={loading} onChange={(next, field) => { setHouse(next); setTouched((current) => new Set(current).add(field)); }} />

          <Section header="Управляющая компания дома">
            {company ? (
              <CellSimple
                title={company.name || 'Новая УК'}
                subtitle={guessed
                  ? 'Подставлена по соседним домам в сервисе — проверьте'
                  : chosen ? `${chosen.subject ? 'Из реестра ФРТ' : 'Уже в сервисе'}${chosen.inn ? `, ИНН ${chosen.inn}` : ''}${chosen.connectedCompanyId ? ' — дом добавится к ней' : ''}` : 'Введена вручную'}
                after={<Button size="small" variant="secondary" onClick={() => { setCompany(null); setChosen(null); setGuessed(false); }}>Другая</Button>}
              />
            ) : (
              <>
                {nearby.map((item) => (
                  <CellSimple key={item.companyId} as="button" onClick={() => chooseConnected(item.companyId, true)}
                    before={<i className="company-swatch" style={{ background: companyColor(item.companyId) }} />}
                    title={item.name} subtitle={`Рядом ${item.houses} ${plural(item.houses, 'её дом', 'её дома', 'её домов')}, ближайший в ${Math.round(item.metres)} м`} showChevron />
                ))}
                <CellSimple subtitle={nearby.length ? 'Или найдите другую УК в реестре по названию или ИНН' : 'Рядом нет домов в сервисе — найдите УК в реестре по названию или ИНН'} />
              </>
            )}
          </Section>

          {!company ? (
            <div className="form">
              <Field label="Управляющая компания">
                <Input maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или ИНН" withClearButton />
              </Field>
              {registry.loading && !results ? <p className="suggestion-empty">Ищем в реестре…</p> : null}
              {results && query.trim().length >= 2 ? (
                <Section>
                  {results.length ? results.map((item) => (
                    <CellSimple key={item.id} as="button" onClick={() => choose(item)} title={item.nameShort || item.nameFull}
                      subtitle={[item.inn ? `ИНН ${item.inn}` : null, item.housesCount ? `${item.housesCount} ${plural(item.housesCount, 'дом', 'дома', 'домов')}` : null, item.connectedCompanyId ? 'уже в сервисе' : null, item.subject].filter(Boolean).join(', ')}
                      showChevron />
                  )) : <CellSimple subtitle="В реестре не нашлось. Проверьте написание или введите УК вручную." />}
                </Section>
              ) : null}
              <Button size="medium" variant="ghost" onClick={() => { setChosen(null); setCompany({ ...emptyCompany, name: query.trim() }); }}>Ввести УК вручную</Button>
            </div>
          ) : !chosen?.connectedCompanyId ? (
            <div className="form">
              <Field label="Название"><Input maxLength={200} value={company.name} onChange={setField('name')} /></Field>
              <Field label="Телефон для жителей" hint={company.phone ? undefined : 'Не найден в реестре — укажите'}><Input maxLength={40} inputMode="tel" value={company.phone} onChange={setField('phone')} onBlur={() => setCompany((current) => (current ? { ...current, phone: formatPhone(current.phone) } : current))} placeholder="+7 (900) 000-00-00" /></Field>
              <div className="form-row">
                <Field label="ИНН"><Input inputMode="numeric" value={company.inn} onChange={setField('inn')} /></Field>
                <Field label="ОГРН"><Input inputMode="numeric" value={company.ogrn} onChange={setField('ogrn')} /></Field>
              </div>
              <Field label="Email"><Input maxLength={200} type="email" value={company.email} onChange={setField('email')} /></Field>
              <Field label="Адрес офиса"><Input maxLength={300} value={company.address} onChange={setField('address')} /></Field>
            </div>
          ) : null}

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <Actions>
            <Button size="large" stretched loading={busy} disabled={!ready || busy} onClick={() => void submit()}>
              {chosen?.connectedCompanyId ? 'Добавить дом к этой УК' : 'Подключить УК и дом'}
            </Button>
          </Actions>
          <p className="footnote muted">© OpenStreetMap, открытые данные ФРТ</p>
        </>
      ) : null}
    </Page>
  );
}

// Metres between two points; enough for "a house nearby".
function metresBetween(left: Point, right: Point) {
  const toRadians = Math.PI / 180;
  const x = (right.longitude - left.longitude) * toRadians * Math.cos(((left.latitude + right.latitude) / 2) * toRadians);
  const y = (right.latitude - left.latitude) * toRadians;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
