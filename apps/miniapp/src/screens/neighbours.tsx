import { useState } from 'react';
import { Button, Input, Switch, Textarea, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type CarMatch } from '../api';
import { bridge } from '../bridge';
import { useNavigation, useStepBack } from '../nav';
import { useLoad, useSession } from '../session';
import { IconTile } from '../components/icons';
import { Empty, Field, Page } from '../components/ui';
import { useConfirm } from '../components/confirm';

// Neighbours: whose car blocks the way, and a message to another apartment of
// the house. The same as "Соседи" in the bot; answers come in the bot.

export function NeighboursScreen() {
  const { me } = useSession();
  const navigation = useNavigation();
  if (!me.residence) {
    return (
      <Page title="Соседи">
        <Empty icon="people" title="Сначала выберите дом" text="Поиск авто и сообщения соседям доступны жителям подтверждённой квартиры."
          action={<Button size="medium" onClick={() => navigation.push({ name: 'map' })}>Найти дом на карте</Button>} />
      </Page>
    );
  }
  return (
    <Page title="Соседи" subtitle={me.residence.building.address}>
      <CarSearch />
      <ApartmentMessage />
      <MyCarsCard />
    </Page>
  );
}

function CarSearch() {
  const { showSnackbar } = useSnackbar();
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<CarMatch[] | null>(null);
  const search = async () => {
    setBusy(true);
    try { setFound(await api.carSearch(plate)); } catch (error) { showSnackbar({ text: errorText(error) }); } finally { setBusy(false); }
  };
  return (
    <section className="tool-card">
      <div className="tool-card-head">
        <IconTile name="car" color="#007aff" />
        <div>
          <span className="tool-card-title">Узнать, чьё авто</span>
          <span className="tool-card-text">Машина перегородила проезд? Найдите владельца по госномеру. Телефон виден, только если владелец разрешил.</span>
        </div>
      </div>
      <form className="address-line" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <Input maxLength={12} value={plate} onChange={(event) => { setPlate(event.target.value); setFound(null); }} placeholder="А123ВС96" autoCapitalize="characters" />
        <Button type="submit" size="medium" loading={busy} disabled={plate.trim().length < 4}>Найти</Button>
      </form>
      {found ? (
        found.length ? found.map((car) => <CarResult key={car.id} car={car} />)
          : <p className="result-empty">Такой машины нет среди подключённых домов. Проверьте номер: буквы можно писать и русскими, и латинскими.</p>
      ) : null}
    </section>
  );
}

function ApartmentMessage() {
  const { showSnackbar } = useSnackbar();
  const [apartment, setApartment] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const result = await api.messageApartment(apartment.trim(), text.trim());
      bridge.haptic('success');
      showSnackbar({ text: `Сообщение отправлено квартире ${result.apartmentNumber}` });
      setText('');
    } catch (error) {
      bridge.haptic('error');
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="tool-card">
      <div className="tool-card-head">
        <IconTile name="send" color="#34c759" />
        <div>
          <span className="tool-card-title">Сообщение квартире</span>
          <span className="tool-card-text">Напишите жителям другой квартиры вашего дома. Сообщение придёт им в MAX от имени вашей квартиры, они смогут ответить.</span>
        </div>
      </div>
      <Field label="Номер квартиры">
        <Input inputMode="numeric" value={apartment} onChange={(event) => setApartment(event.target.value)} placeholder="Например, 45" />
      </Field>
      <Field label="Сообщение">
        <Textarea value={text} maxLength={1000} rows={3} onChange={(event) => setText(event.target.value)} placeholder="Например: у вас в машине во дворе открыто окно" />
      </Field>
      <Button size="large" stretched loading={busy} disabled={!apartment.trim() || text.trim().length < 2 || busy} onClick={() => void send()}>Отправить</Button>
    </section>
  );
}

// The resident's own cars: neighbours find the owner by the plate. The phone is
// shown only when the apartment allowed it.
function MyCarsCard() {
  const { showSnackbar } = useSnackbar();
  const cars = useLoad(() => api.myCars(), []);
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  useStepBack(adding, () => setAdding(false));
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [carPhone, setCarPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [owner, setOwner] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const data = cars.data;

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); bridge.haptic('success'); showSnackbar({ text: success }); await cars.reload(); return true; }
    catch (error) { bridge.haptic('error'); showSnackbar({ text: errorText(error) }); return false; }
    finally { setBusy(false); }
  };
  const add = async () => {
    const done = await act(() => api.addCar({ plate: plate.trim(), ...(owner.trim() ? { owner: owner.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) }), 'Автомобиль добавлен');
    if (done) { setAdding(false); setPlate(''); setOwner(''); setPhone(''); }
  };

  return (
    <section className="tool-card">
      <div className="tool-card-head">
        <IconTile name="key" color="#ff9500" />
        <div>
          <span className="tool-card-title">Мои автомобили</span>
          <span className="tool-card-text">Добавьте свою машину, чтобы сосед мог позвонить, если она мешает проезду.</span>
        </div>
      </div>
      {!data ? null : (
        <>
          {data.items.map((car) => (
            <div key={car.id} className="result-card result-card-row">
              <div className="result-card-body">
                <span className="result-card-title">{car.plate}</span>
                <span className="result-card-text">{[car.owner, ...car.phones].filter(Boolean).join(', ') || 'Владелец не указан'}</span>
                {car.phones.length ? null : (
                  <div className="car-phone">
                    <span className="warn-text">Телефона нет — соседи смогут только написать.</span>
                    {bridge.canRequestPhone ? (
                      <Button size="medium" stretched disabled={busy} onClick={async () => {
                        const phone = await bridge.requestPhone();
                        if (!phone) { showSnackbar({ text: 'Номер не получен. Разрешите MAX передать номер или попробуйте ещё раз.' }); return; }
                        void act(() => api.updateCar(car.id, { phone }), 'Номер из MAX сохранён');
                      }}>Взять номер из MAX</Button>
                    ) : editingPhone === car.id ? (
                      <div className="form">
                        <Input maxLength={40} inputMode="tel" value={carPhone} onChange={(event) => setCarPhone(event.target.value)} placeholder="+7 (900) 123-45-67" />
                        <Button size="medium" stretched disabled={carPhone.replace(/\D/g, '').length < 10 || busy} onClick={() => void act(() => api.updateCar(car.id, { phone: carPhone.trim() }), 'Телефон сохранён').then(() => setEditingPhone(null))}>Сохранить телефон</Button>
                      </div>
                    ) : <Button size="medium" variant="secondary" stretched onClick={() => { setCarPhone(''); setEditingPhone(car.id); }}>Указать телефон</Button>}
                  </div>
                )}
              </div>
              <Button size="small" variant="secondary" disabled={busy} onClick={async () => { if (await confirm({ text: `Удалить ${car.plate} из своих автомобилей? Соседи больше не найдут вас по этому номеру.`, confirm: 'Удалить', destructive: true })) void act(() => api.removeCar(car.id), 'Автомобиль удалён'); }}>Удалить</Button>
            </div>
          ))}
          <label className="switch-row">
            <span className="switch-row-text">
              <span className="switch-row-title">Показывать телефон при поиске</span>
              <span className="switch-row-sub">{data.showPhone ? 'Сосед, который ищет вашу машину, увидит номер владельца' : 'Сейчас соседи не увидят номер'}</span>
            </span>
            <Switch checked={data.showPhone} disabled={busy} onChange={(event) => void act(() => api.setPhoneVisibility(event.target.checked), event.target.checked ? 'Телефон будет виден при поиске' : 'Телефон скрыт')} />
          </label>
          {adding ? (
            <div className="form">
              <Field label="Госномер"><Input maxLength={12} value={plate} onChange={(event) => setPlate(event.target.value)} placeholder="А123ВС96" autoCapitalize="characters" /></Field>
              <Field label="Владелец" hint="Если не указать, владельцем будете вы"><Input maxLength={150} value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Имя" /></Field>
              <Field label="Телефон владельца" hint={data.sharedPhone && !owner.trim() ? `Если не указать, возьмём ваш номер из MAX: ${data.sharedPhone}` : undefined}>
                <Input maxLength={40} inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 900 123-45-67" />
              </Field>
              <Button size="large" stretched loading={busy} disabled={plate.trim().length < 5 || busy} onClick={() => void add()}>Добавить</Button>
              <Button size="medium" variant="ghost" onClick={() => setAdding(false)}>Отмена</Button>
            </div>
          ) : data.items.length < data.limit ? (
            <Button size="medium" variant="secondary" stretched onClick={() => setAdding(true)}>Добавить автомобиль</Button>
          ) : null}
        </>
      )}
    </section>
  );
}

// A found car: the phone when the owner allowed it, and a message through the
// service in any case — it reaches the residents of the car's apartment.
function CarResult({ car }: { car: CarMatch }) {
  const { showSnackbar } = useSnackbar();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.messageCarOwner(car.id, text.trim());
      bridge.haptic('success');
      showSnackbar({ text: 'Сообщение отправлено владельцу' });
      setWriting(false);
      setText('');
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="result-card">
      <span className="result-card-title">{car.plate}</span>
      <span className="result-card-text">
        {car.mine ? 'Это ваш автомобиль' : [car.owner, car.address].filter(Boolean).join(', ') || 'Владелец не показывает телефон'}
      </span>
      {car.phones.length > 1 ? <span className="result-card-text">Телефоны: {car.phones.join(', ')}</span> : null}
      {!car.mine && (car.phones.length || car.canMessage) ? (
        <div className="button-pair">
          {car.phones.length ? <Button size="medium" stretched onClick={() => window.open(`tel:${car.phones[0]!.replace(/[^\d+]/g, '')}`)}>Позвонить</Button> : null}
          {car.canMessage ? <Button size="medium" variant="secondary" stretched onClick={() => setWriting((value) => !value)}>Написать</Button> : null}
        </div>
      ) : null}
      {!car.mine && car.phones.length === 0 && car.canMessage ? <span className="result-card-text">Владелец не указал телефон — напишите ему, сообщение придёт в MAX.</span> : null}
      {writing ? (
        <div className="form">
          <Textarea value={text} rows={3} maxLength={1000} onChange={(event) => setText(event.target.value)} placeholder="Например: ваша машина перекрыла выезд, подойдите, пожалуйста" />
          <Button size="medium" stretched loading={busy} disabled={text.trim().length < 2 || busy} onClick={() => void send()}>Отправить владельцу</Button>
        </div>
      ) : null}
    </div>
  );
}
