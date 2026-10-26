import { useState } from 'react';
import { Button, CellAction, CellSimple, Switch, Typography, useSnackbar } from '@maxhub/max-ui';
import { api, errorText } from '../api';
import { bridge } from '../bridge';
import { useNavigation } from '../nav';
import { useLoad, useSession } from '../session';
import { IconTile } from '../components/icons';
import { HouseMap } from '../components/HouseMap';
import { Actions, Empty, Failure, Loading, Page, Section } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { useUnread } from '../unread';
import { ago, roleLabels, addressLines } from '../labels';

export function MoreScreen() {
  const { me, refresh, mode, setMode } = useSession();
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const [savingReminders, setSavingReminders] = useState(false);
  const setReminders = async (enabled: boolean) => {
    setSavingReminders(true);
    try {
      await api.desk.setLegalReminders(enabled);
      await refresh();
      showSnackbar({ text: enabled ? 'Напоминания о сроках включены' : 'Напоминания о сроках отключены' });
    } catch (error) { showSnackbar({ text: errorText(error) }); } finally { setSavingReminders(false); }
  };
  const leave = async () => {
    if (!await confirm({ text: 'Отвязаться от квартиры? Заявки дома и объявления станут недоступны, а согласие на обработку данных будет отозвано: телефон и автомобили сотрутся.', confirm: 'Отвязаться', destructive: true })) return;
    try {
      const left = await api.leaveResidence();
      await refresh();
      showSnackbar({ text: 'Привязка к квартире удалена' });
      // The last resident decides whether the next ones see the names,
      // phones and cars of the apartment.
      if (left.apartmentId && left.canClearData && await confirm({ text: 'В профиле прежней квартиры остались ФИО, телефоны или автомобили. Новые жильцы смогут их увидеть. Удалить эти данные?', confirm: 'Удалить', cancel: 'Оставить', destructive: true })) {
        await api.clearPreviousApartment(left.apartmentId);
        showSnackbar({ text: 'Данные прежней квартиры удалены' });
      }
    } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  // A company employee or the platform administrator gives up their access.
  const leaveAdmin = async () => {
    const what = me.admin?.role === 'platform_admin' ? 'администратора платформы' : `сотрудника «${me.admin?.company?.name ?? 'УК'}»`;
    if (!await confirm({ text: `Отвязаться от админки? Права ${what} пропадут сразу — в приложении, в боте и в веб-версии. Вернуться можно только по новому приглашению.`, confirm: 'Отвязаться', destructive: true })) return;
    try { await api.leaveAdmin(); setMode('resident'); await refresh(); showSnackbar({ text: 'Вы отвязались от админки' }); } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  // The platform administrator in the administration mode is not a resident.
  const isPlatform = mode === 'platform';
  return (
    <Page title="Ещё">
      {/* Only what is not anywhere else: announcements, the map and contacts
          have their own places on the home screen and in the tabs. */}
      {me.residence && !isPlatform ? (
        <Section header="Мой дом">
          <CellSimple before={<IconTile name="building" color="#007aff" />} title={addressLines(me.residence.building.street, me.residence.building.house).main}
            subtitle={<span className="address-details">{[...addressLines(me.residence.building.street, me.residence.building.house, me.residence.apartmentNumber).details, `УК: ${me.residence.company.name}`].map((line) => <span key={line}>{line}</span>)}</span>} />
          <CellAction onClick={() => navigation.push({ name: 'join-house', buildingId: me.residence!.building.id, address: me.residence!.building.address, change: true })} showChevron>Сменить квартиру в этом доме</CellAction>
          <CellAction onClick={() => navigation.push({ name: 'map' })} showChevron>Сменить дом</CellAction>
          <CellAction mode="destructive" onClick={() => void leave()}>Отвязаться от квартиры</CellAction>
        </Section>
      ) : null}
      {me.admin && me.admin.role !== 'platform_admin' && mode === 'company' ? (
        <Section header="Работа в УК">
          <CellSimple before={<IconTile name="desk" color="#5856d6" />} title={me.admin.company?.name ?? 'Управляющая компания'} subtitle="Вы сотрудник этой УК" />
          <label className="switch-row">
            <span className="switch-row-text">
              <span className="switch-row-title">Напоминания о сроках заявок</span>
              <span className="switch-row-sub">{me.admin.legalReminders ? 'Бот напишет в MAX, когда срок по закону скоро истечёт и когда он истёк' : 'Бот не пишет о сроках. Сроки видны в пульте'}</span>
            </span>
            <Switch checked={me.admin.legalReminders} disabled={savingReminders} onChange={(event) => void setReminders(event.target.checked)} />
          </label>
          <CellAction mode="destructive" onClick={() => void leaveAdmin()}>Отвязаться от админки</CellAction>
        </Section>
      ) : null}
      {me.admin?.role === 'platform_admin' && isPlatform ? (
        <Section header="Администратор платформы">
          <CellAction mode="destructive" onClick={() => void leaveAdmin()}>Отвязаться от админки</CellAction>
        </Section>
      ) : null}
      <Section header="Справка">
        <CellSimple as="button" before={<IconTile name="shield" color="#8a8f98" />} title="Политика обработки данных" subtitle="Какие данные хранятся и зачем" onClick={() => navigation.push({ name: 'privacy' })} showChevron />
        <CellSimple as="button" before={<IconTile name="shield" color="#5856d6" />} title="Обязанности УК и сроки" subtitle="Что УК должна делать по закону" onClick={() => navigation.push({ name: 'duties' })} showChevron />
        {mode !== 'resident' ? null : <CellSimple as="button" before={<IconTile name="home" color="#007aff" />} title="Что умеет Домовед" subtitle="Подключение к дому, заявки, соседи, службы" onClick={() => navigation.push({ name: 'help', role: 'resident' })} showChevron />}
        {me.admin && mode !== 'resident' ? <CellSimple as="button" before={<IconTile name="desk" color="#5856d6" />} title="Как работает пульт" subtitle="Для сотрудников УК" onClick={() => navigation.push({ name: 'help', role: 'company' })} showChevron /> : null}
        {isPlatform ? <CellSimple as="button" before={<IconTile name="platform" color="#ff9500" />} title="Как работает платформа" subtitle="Подключение домов и УК" onClick={() => navigation.push({ name: 'help', role: 'platform' })} showChevron /> : null}
      </Section>
    </Page>
  );
}

const audienceLabels = { all: 'Всем жителям', street: 'Улице', building: 'Дому', apartment: 'Вашей квартире' } as const;

export function AnnouncementsScreen() {
  const list = useLoad(() => api.announcements(), []);
  const unread = useUnread();
  const { showSnackbar } = useSnackbar();
  if (list.error) return <Failure text={list.error} retry={list.reload} />;
  if (!list.data) return <Loading />;
  const fresh = list.data.filter((item) => !item.read);
  const markRead = async (ids?: string[]) => {
    try {
      await api.markAnnouncementsRead(ids);
      list.setData((items) => items?.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)) ?? null);
      void unread.refresh();
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    }
  };
  return (
    <Page title="Объявления УК" after={fresh.length > 1 ? <Button size="small" variant="secondary" onClick={() => void markRead()}>Прочитать все</Button> : undefined}>
      {list.data.length ? (
        <div className="announcements">
          {list.data.map((item) => (
            <article key={item.id} className={`announcement${item.read ? '' : ' announcement-new'}`}>
              <header className="announcement-head">
                <span>{audienceLabels[item.audience]}, {ago(item.createdAt)}</span>
                {item.read ? <span className="announcement-read">Прочитано</span> : <span className="tag tag-new">Новое</span>}
              </header>
              <p className="announcement-text pre-wrap">{item.text}</p>
              {item.read ? null : <Button size="small" variant="secondary" onClick={() => void markRead([item.id])}>Прочитано</Button>}
            </article>
          ))}
        </div>
      ) : <Empty icon="megaphone" title="Объявлений пока нет" text="Когда УК объявит об отключении воды или работах в доме, сообщение придёт сюда и в чат с ботом." />}
    </Page>
  );
}


const call = (phone: string) => window.open(`tel:${phone.replace(/[^\d+]/g, '')}`);

export function ContactsScreen() {
  const data = useLoad(() => api.contacts(), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  // The quick dial row comes from the company of the house, or the standard numbers.
  const { emergencyServices, quickDial } = data.data;
  return (
    <Page title="Службы">
      <div className="alert-card">При угрозе жизни или здоровью звоните <a href="tel:112">112</a>.</div>
      <section className="section">
        <h2 className="section-header">Быстрый набор</h2>
        <div className="quick-dial">
          {quickDial.map((item) => (
            <a key={`${item.number}-${item.title}`} className="quick-dial-item" href={`tel:${item.number.replace(/[^\d+]/g, '')}`} aria-label={`Позвонить ${item.number}, ${item.title}`}>
              <span className="quick-dial-number">{item.number}</span>
              <span className="quick-dial-title">{item.title}</span>
            </a>
          ))}
        </div>
      </section>
      <Section header="Аварийные службы вашего дома">
        {emergencyServices.length ? emergencyServices.map((service) => (
          <CellSimple key={service.id} as="button" onClick={() => call(service.phone)} title={service.name} subtitle={<span className="address-details"><span className="service-phone">{service.phone}</span>{service.description ? <span>{service.description}</span> : null}</span>} before={<IconTile name="siren" color="#ff3b30" />} after={<span className="call-hint"><IconTile name="phone" color="#34c759" size={28} /></span>} />
        )) : <CellSimple subtitle="Номера служб пока не добавлены." />}
      </Section>
    </Page>
  );
}

// The company of the house: how to reach it, when it receives residents.
export function CompanyInfoScreen() {
  const { me } = useSession();
  const navigation = useNavigation();
  const data = useLoad(() => api.contacts(), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const { company } = data.data;
  const building = me.residence?.building;
  const office = company?.latitude != null && company.longitude != null ? { latitude: company.latitude, longitude: company.longitude } : null;
  const home = building?.latitude != null && building.longitude != null ? { id: building.id, latitude: building.latitude, longitude: building.longitude, label: building.address } : null;
  if (!company) return <Page title="Моя УК"><Empty icon="building" title="УК появится после выбора дома" text="Найдите свой дом на карте и подтвердите квартиру." /></Page>;
  return (
    <Page title="Моя УК" subtitle={company.name}>
      <Section>
        <CellAction onClick={() => call(company.phone)} before={<IconTile name="phone" color="#34c759" />}>{company.phone}</CellAction>
        {company.email ? <CellAction onClick={() => window.open(`mailto:${company.email}`)} before={<IconTile name="chat" color="#007aff" />}>{company.email}</CellAction> : null}
      </Section>
      <Section header="Когда работает">
        <CellSimple before={<IconTile name="bell" color="#007aff" />} title="Часы работы" subtitle={company.workingHours || 'Не указаны'} />
        <CellSimple before={<IconTile name="people" color="#5856d6" />} title="Приём граждан" subtitle={company.receptionHours || 'Не указан'} />
        <CellSimple before={<IconTile name="shield" color="#8a8f98" />} title="Выходные дни" subtitle={company.daysOff || 'Не указаны'} />
      </Section>
      {company.address ? (
        <Section header="Офис">
          <CellSimple before={<IconTile name="pin" color="#ff9500" />} title={company.address} />
        </Section>
      ) : null}
      {office ? (
        <div className="company-office-map">
          <HouseMap height={260} offices={[{ id: company.id, name: company.name, latitude: office.latitude, longitude: office.longitude, selected: true }]}
            houses={home ? [{ id: home.id, latitude: home.latitude, longitude: home.longitude, openIssues: 0, label: home.label, selected: true }] : []} />
          <p className="field-hint">Фиолетовая метка «УК» — офис{home ? ', ваш дом отмечен рамкой' : ''}.</p>
        </div>
      ) : null}
      {company.cleaningInfo ? (
        <Section header="Уборка и благоустройство">
          <CellSimple before={<IconTile name="home" color="#34c759" />} subtitle={<span className="multiline">{company.cleaningInfo}</span>} />
        </Section>
      ) : null}
      <Section>
        <CellSimple as="button" before={<IconTile name="calendar" color="#34c759" />} title="Записаться на приём" subtitle={company.receptionHours || 'Выберите свободное время'} onClick={() => navigation.push({ name: 'appointments' })} showChevron />
        <CellSimple as="button" before={<IconTile name="shield" color="#5856d6" />} title="Обязанности УК и сроки" subtitle="Что УК должна делать по закону" onClick={() => navigation.push({ name: 'duties' })} showChevron />
      </Section>
      {company.note ? <div className="info-card"><span className="info-card-text">{company.note}</span></div> : null}
    </Page>
  );
}

export function InviteScreen({ token }: { token: string }) {
  const { refresh } = useSession();
  const navigation = useNavigation();
  const invite = useLoad(() => api.invite(token), [token]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (invite.error) return <Failure text={invite.error} />;
  if (!invite.data) return <Loading />;
  const item = invite.data;
  const accept = async () => {
    setBusy(true);
    try {
      await api.acceptInvite(token);
      bridge.haptic('success');
      await refresh();
      navigation.switchTab('desk');
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Приглашение в команду УК">
      <div className="hero-card">
        <Typography.Title variant="medium-strong">{item.company.name}</Typography.Title>
        <Typography.Body variant="medium">Вас приглашают как: {roleLabels[item.role]}. В приложении появится пульт УК: заявки домов, карта, объявления жителям. О новых заявках вы будете узнавать в MAX.</Typography.Body>
        {item.used || item.expired ? <div className="form-error">{item.used ? 'Приглашение уже использовано.' : 'Срок приглашения истёк.'}</div> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <Actions>
          <Button size="large" stretched loading={busy} disabled={item.used || item.expired} onClick={() => void accept()}>Принять приглашение</Button>
          <Button size="large" variant="ghost" stretched onClick={() => navigation.back()}>Не сейчас</Button>
        </Actions>
      </div>
    </Page>
  );
}

