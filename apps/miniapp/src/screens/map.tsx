import { useMemo, useState } from 'react';
import { Button, CellAction, CellSimple, Input, Segmented, Typography, useSnackbar } from '@maxhub/max-ui';
import { api, ApiError, errorText, type BuildingCard, type MapData } from '../api';
import { bridge } from '../bridge';
import { useNavigation } from '../nav';
import { useLoad, useSession } from '../session';
import { companyColor, HouseMap, MapLegend, type Point } from '../components/HouseMap';
import { AddressSearch } from '../components/AddressSearch';
import type { AddressSuggestion } from '../api';
import { Icon, IconTile } from '../components/icons';
import { Actions, Failure, Field, IncidentCell, Loading, Page, Section, Sheet } from '../components/ui';
import { distance, plural } from '../labels';

export function MapScreen({ focusBuildingId }: { focusBuildingId?: string }) {
  const { me } = useSession();
  const { showSnackbar } = useSnackbar();
  const map = useLoad(() => api.map(), []);
  const [selected, setSelected] = useState<string | null>(focusBuildingId ?? null);
  const [office, setOffice] = useState<string | null>(null);
  const [view, setView] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);
  const [outside, setOutside] = useState<{ label: string; point: Point } | null>(null);

  const myBuildingId = me.residence?.building.id;
  // The company in focus: of the chosen office or of the chosen house. Its
  // houses are highlighted on the map, the others step back.
  const [pinnedCompany, setPinnedCompany] = useState<string | null>(null);
  const focusCompanyId = office ?? pinnedCompany ?? (selected ? map.data?.buildings.find((house) => house.id === selected)?.companyId ?? null : null);
  const houses = useMemo(() => (map.data?.buildings ?? [])
    .filter((house) => house.latitude !== null && house.longitude !== null)
    .map((house) => ({
      id: house.id, latitude: house.latitude!, longitude: house.longitude!, openIssues: house.openIssues, label: house.address, companyId: house.companyId,
      selected: house.id === selected || house.id === myBuildingId,
      highlighted: Boolean(focusCompanyId) && house.companyId === focusCompanyId,
      muted: Boolean(focusCompanyId) && house.companyId !== focusCompanyId,
    })), [map.data, selected, myBuildingId, focusCompanyId]);
  const offices = useMemo(() => (map.data?.companies ?? [])
    .filter((company) => company.latitude != null && company.longitude != null)
    .map((company) => ({ id: company.id, latitude: company.latitude!, longitude: company.longitude!, name: company.name, selected: company.id === office })), [map.data, office]);
  const focus = selected ? houses.find((house) => house.id === selected) ?? null : outside?.point ?? null;

  // An address from the search is one of the connected houses if it is at the
  // same place or has the same street and number in the same town (30 km).
  const openAddress = (address: AddressSuggestion) => {
    if (!address.house) { setView({ latitude: address.latitude, longitude: address.longitude, zoom: 17 }); return; }
    const label = `${address.street}, ${address.house}`;
    const street = address.street.toLowerCase().replace(/^(улица|проспект|переулок|бульвар|шоссе)\s+|\s+(улица|проспект|переулок|бульвар|шоссе)$/g, '');
    const house = (map.data?.buildings ?? []).find((item) => (
      item.latitude !== null && distance({ latitude: item.latitude!, longitude: item.longitude! }, address) < 70
    ) || (item.latitude !== null && distance({ latitude: item.latitude!, longitude: item.longitude! }, address) < 30_000 && item.address.toLowerCase().includes(street) && new RegExp(`(^|\\D)${address.house!.replace(/[^\dа-яa-z]/gi, '')}(\\D|$)`, 'i').test(item.address.replace(/\s/g, ''))));
    setOffice(null);
    if (house) { setOutside(null); setSelected(house.id); }
    else { setSelected(null); setOutside({ label, point: { latitude: address.latitude, longitude: address.longitude } }); }
  };
  // "Найти меня": the map moves to the person and opens the nearest connected
  // house with its management company.
  const [locating, setLocating] = useState(false);
  const locate = () => {
    if (!navigator.geolocation) { showSnackbar({ text: 'Устройство не сообщает местоположение. Введите город и адрес.' }); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setLocating(false);
      const here = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      const nearest = (map.data?.buildings ?? [])
        .filter((house) => house.latitude !== null && house.longitude !== null)
        .map((house) => ({ house, metres: distance({ latitude: house.latitude!, longitude: house.longitude! }, here) }))
        .sort((left, right) => left.metres - right.metres)[0];
      setOffice(null);
      setOutside(null);
      if (nearest && nearest.metres < 50_000) {
        setSelected(nearest.house.id);
      } else {
        setView({ ...here, zoom: 14 });
        showSnackbar({ text: 'Рядом с вами пока нет подключённых домов.' });
      }
    }, () => {
      setLocating(false);
      showSnackbar({ text: 'Не удалось определить местоположение. Разрешите доступ к геопозиции или введите адрес.' });
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  };
  // Show the houses of one company: highlight them and move the map to them.
  const showCompany = (companyId: string) => {
    setPinnedCompany(companyId);
    const points = (map.data?.buildings ?? []).filter((house) => house.companyId === companyId && house.latitude !== null);
    if (points.length) {
      const latitude = points.reduce((sum, house) => sum + house.latitude!, 0) / points.length;
      const longitude = points.reduce((sum, house) => sum + house.longitude!, 0) / points.length;
      setView({ latitude, longitude, zoom: points.length > 1 ? 12 : 16 });
    }
  };
  const companyName = (id: string) => map.data?.companies.find((company) => company.id === id)?.name ?? '';

  if (map.error) return <Failure text={map.error} retry={map.reload} />;
  if (!map.data) return <Loading />;

  return (
    <Page title="Найти свой дом">
      <AddressSearch onCity={(city) => setView({ latitude: city.latitude, longitude: city.longitude, zoom: 13 })} onAddress={openAddress} hint="Подключённые дома отмечены на карте — нажмите на свой" />
      <button type="button" className="locate-button" onClick={locate} disabled={locating}>
        <Icon name="locate" size={20} />
        <span>{locating ? 'Определяем место…' : 'Найти меня'}</span>
        <span className="locate-button-sub">ближайший подключённый дом и его УК</span>
      </button>
      <MapLegend offices />
      <HouseMap
        houses={houses} offices={offices} locate={false}
        onHouse={(id) => { setOffice(null); setOutside(null); setPinnedCompany(null); setSelected(id); }}
        onOffice={(id) => { setSelected(null); setOffice(id); }}
        focus={focus} focusZoom={17} view={view} pin={outside?.point ?? null}
        fill expandable
      />
      {focusCompanyId ? (
        <div className="map-company-note">
          <i style={{ background: companyColor(focusCompanyId) }} />
          <span>Подсвечены дома <b>{companyName(focusCompanyId)}</b>: {map.data.buildings.filter((house) => house.companyId === focusCompanyId).length}</span>
          <button type="button" onClick={() => { setSelected(null); setOffice(null); setPinnedCompany(null); }}>Все дома</button>
        </div>
      ) : null}
      {/* Houses without a point on the map can still be found in the list. */}
      <Section header={houses.length ? 'Все дома' : 'Дома ещё не отмечены на карте — выберите из списка'}>
        {map.data.buildings.slice().sort((left, right) => left.address.localeCompare(right.address, 'ru', { numeric: true })).map((house) => (
          <CellSimple key={house.id} as="button" title={house.address} subtitle={companyName(house.companyId)} onClick={() => { setOffice(null); setSelected(house.id); }} showChevron />
        ))}
      </Section>
      <Sheet open={Boolean(selected)} onClose={() => setSelected(null)} title="Дом">
        {selected ? <BuildingSheet id={selected} close={() => setSelected(null)} onShowCompany={(companyId) => { setSelected(null); showCompany(companyId); }} /> : null}
      </Sheet>
      <Sheet open={Boolean(outside)} onClose={() => setOutside(null)} title="Дом">
        {outside ? (
          <div className="sheet">
            <div className="info-card">
              <span className="info-card-title">{outside.label}</span>
              <span className="info-card-text">Этот дом пока не подключён. Расскажите о Домоведе своей управляющей компании: подключение займёт пару минут.</span>
            </div>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={Boolean(office)} onClose={() => setOffice(null)} title="Управляющая компания">
        {office ? <OfficeSheet company={map.data.companies.find((company) => company.id === office)!} houses={map.data.buildings.filter((house) => house.companyId === office).length} onShow={() => { showCompany(office); setOffice(null); }} /> : null}
      </Sheet>
    </Page>
  );
}

function OfficeSheet({ company, houses, onShow }: { company: MapData['companies'][number]; houses: number; onShow: () => void }) {
  return (
    <div className="sheet">
      <div className="info-card">
        <span className="info-card-title">{company.name}</span>
        <span className="info-card-text">{houses} {plural(houses, 'дом', 'дома', 'домов')} в сервисе</span>
      </div>
      <Section>
        <CellAction onClick={() => window.open(`tel:${company.phone.replace(/[^\d+]/g, '')}`)} before={<IconTile name="phone" color="#34c759" />}>{company.phone}</CellAction>
        {company.address ? <CellSimple title="Офис" subtitle={company.address} /> : null}
        {company.workingHours ? <CellSimple title="Часы работы" subtitle={company.workingHours} /> : null}
        <CellAction onClick={onShow} before={<IconTile name="map" color={companyColor(company.id)} />} showChevron>Показать дома этой УК на карте</CellAction>
      </Section>
    </div>
  );
}

function BuildingSheet({ id, close, onShowCompany }: { id: string; close: () => void; onShowCompany: (companyId: string) => void }) {
  const navigation = useNavigation();
  const { me } = useSession();
  const card = useLoad(() => api.building(id), [id]);
  if (card.error) return <Failure text={card.error} retry={card.reload} />;
  if (!card.data) return <Loading />;
  const house: BuildingCard = card.data;
  const issues = house.openIssues;
  const isMine = me.residence?.building.id === house.id;
  return (
    <div className="sheet">
      <div className="info-card">
        <span className="info-card-title">{house.address}</span>
        <span className="info-card-text">
          {house.connectedApartments} {plural(house.connectedApartments, 'квартира', 'квартиры', 'квартир')} из {house.apartmentsCount} уже в сервисе
        </span>
      </div>
      <Section header="Управляет домом">
        <CellSimple title={house.company.name} subtitle={house.company.workingHours ?? undefined} />
        <CellAction onClick={() => window.open(`tel:${house.company.phone.replace(/[^\d+]/g, '')}`)} before={<IconTile name="phone" color="#34c759" />}>{house.company.phone}</CellAction>
        <CellAction onClick={() => onShowCompany(house.company.id)} before={<IconTile name="map" color={companyColor(house.company.id)} />} showChevron>Все дома этой УК на карте</CellAction>
      </Section>
      <Section header={issues.length ? `Открытые проблемы: ${issues.length}` : 'Проблемы в доме'}>
        {!issues.length ? <CellSimple before={<IconTile name="shield" color="#34c759" />} title="Открытых проблем нет" /> : null}
        {issues.slice(0, 5).map((issue) => (
          <IncidentCell key={issue.id} {...issue} when={issue.createdAt} onClick={() => { if (house.isResident) { close(); navigation.push({ name: 'incident', ref: issue.id }); } }} />
        ))}
        {!house.isResident && issues.length ? <CellSimple subtitle="Подробности видят только жители дома." /> : null}
      </Section>
      <Actions>
        {isMine ? (
          <Button size="large" stretched onClick={() => { close(); navigation.push({ name: 'new-incident' }); }}>Сообщить о проблеме</Button>
        ) : (
          <Button size="large" stretched onClick={() => { close(); navigation.push({ name: 'join-house', buildingId: house.id, address: house.address }); }}>
            {me.residence ? 'Я переехал сюда' : 'Это мой дом'}
          </Button>
        )}
      </Actions>
    </div>
  );
}

export function JoinHouseScreen({ buildingId, address, change = false }: { buildingId: string; address: string; change?: boolean }) {
  const { me, refresh } = useSession();
  const navigation = useNavigation();
  const [apartmentNumber, setApartmentNumber] = useState('');
  const [buildingCode, setBuildingCode] = useState('');
  const [apartmentCode, setApartmentCode] = useState('');
  const [needsApartmentCode, setNeedsApartmentCode] = useState(false);
  // Two ways to prove the apartment: codes from the company or the number of
  // the management contract (from a receipt or the contract itself).
  const [method, setMethod] = useState<'codes' | 'contract'>('codes');
  const [contractNumber, setContractNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'bound' | 'join_requested' | null>(null);

  const [consent, setConsent] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = method === 'contract'
        ? await api.bindResidence({ buildingId, apartmentNumber: apartmentNumber.trim(), contractNumber: contractNumber.trim(), consent })
        : await api.bindResidence({ buildingId, apartmentNumber: apartmentNumber.trim(), buildingCode: buildingCode.replace(/\s/g, ''), ...(needsApartmentCode ? { apartmentCode } : {}), consent });
      if (result.status === 'apartment_code_required') { setNeedsApartmentCode(true); return; }
      bridge.haptic('success');
      setDone(result.status);
      await refresh();
    } catch (failure) {
      bridge.haptic('error');
      setError(errorText(failure));
      if (failure instanceof ApiError && failure.code === 'too_many_attempts') setBuildingCode('');
    } finally {
      setBusy(false);
    }
  };

  // The screen stays in the stack of the map tab: coming back after the
  // apartment was confirmed shows the result, not the form again.
  // Changing the apartment inside the same house starts from the form.
  const settled = done ?? (change ? null : me.residence?.building.id === buildingId ? 'bound' : me.pendingJoin ? 'join_requested' : null);
  if (settled) {
    return (
      <Page title={settled === 'bound' ? 'Квартира подтверждена' : 'Запрос отправлен'} subtitle={settled === 'bound' && me.residence ? `${me.residence.building.address}, кв. ${me.residence.apartmentNumber}` : address}>
        <div className="hero-card">
          <Typography.Body variant="medium">
            {settled === 'bound'
              ? 'Теперь вы видите заявки дома, объявления УК и можете сообщать о проблемах. Уведомления придут в чат с ботом.'
              : 'В квартире уже есть подключённые жители. Они получили запрос в MAX — после подтверждения вам откроются заявки дома.'}
          </Typography.Body>
          <Button size="large" stretched onClick={() => { navigation.back(); navigation.switchTab('home'); }}>На главную</Button>
        </div>
      </Page>
    );
  }

  const ready = (consent || me.user.consent) && apartmentNumber.trim() && (method === 'contract'
    ? contractNumber.replace(/[\s-]/g, '').length >= 6
    : buildingCode.replace(/\s/g, '').length >= 4 && (!needsApartmentCode || apartmentCode.trim().length >= 6));
  return (
    <Page title={change ? 'Другая квартира' : 'Подтверждение квартиры'} subtitle={change ? `${address}. Сейчас: кв. ${me.residence?.apartmentNumber ?? '—'}` : address}>
      <div className="form">
        <Field label="Номер квартиры">
          <Input inputMode="numeric" placeholder="Например, 45" value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} />
        </Field>
        <Segmented items={[{ id: 'codes', title: 'Код от УК' }, { id: 'contract', title: 'Номер договора' }]} activeItem={method} onClick={(id) => { setMethod(id as 'codes' | 'contract'); setError(null); }} />
        {method === 'contract' ? (
          <Field label="Номер договора" hint="Обычно 10 цифр, бывает с буквами и «/». Есть в квитанции и в договоре управления. С ним подключение сразу, без кодов.">
            <Input inputMode="numeric" placeholder="0000000000" maxLength={24} value={contractNumber} onChange={(event) => setContractNumber(event.target.value)} />
          </Field>
        ) : (
          <Field label="Код дома" hint="Ровно 10 цифр. Его выдаёт управляющая компания: на доске объявлений, в квитанции или в чате дома. Номер договора тоже подойдёт.">
            <Input inputMode="numeric" placeholder="0000000000" maxLength={30} value={buildingCode} onChange={(event) => setBuildingCode(event.target.value)} />
          </Field>
        )}
        {needsApartmentCode && method === 'codes' ? (
          <Field label="Код квартиры" hint="Не короче 6 символов, обычно 6 цифр. У этой квартиры есть личный код — его выдаёт УК собственнику.">
            <Input maxLength={64} value={apartmentCode} onChange={(event) => setApartmentCode(event.target.value)} autoFocus />
          </Field>
        ) : null}
        {me.user.consent ? null : (
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>Согласен на обработку персональных данных по <button type="button" className="link-button" onClick={() => navigation.push({ name: 'privacy' })}>политике</button>: адрес, квартира, имя из MAX, заявки и фото.</span>
          </label>
        )}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <Button size="large" stretched loading={busy} disabled={!ready || busy} onClick={() => void submit()}>Подтвердить</Button>
      </div>
    </Page>
  );
}


