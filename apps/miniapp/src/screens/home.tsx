import { useEffect } from 'react';
import { Button, CellAction, CellSimple, useSnackbar } from '@maxhub/max-ui';
import { api, errorText } from '../api';
import { useNavigation } from '../nav';
import { useLoad, useSession } from '../session';
import { Actions, Empty, IncidentCell, Page, QuickAction, Section } from '../components/ui';
import { Icon, IconTile } from '../components/icons';
import { useUnread } from '../unread';
import { ago, addressLines } from '../labels';

export function HomeScreen() {
  const { me } = useSession();
  const name = me.user.displayName?.split(' ')[0];

  return (
    <Page title={name ? `Привет, ${name}` : 'Домовед'}>
      {me.residence ? <ResidentHome /> : me.pendingJoin ? <PendingJoin /> : <Welcome />}
    </Page>
  );
}

function ResidentHome() {
  const { me } = useSession();
  const unread = useUnread();
  const navigation = useNavigation();
  const house = useLoad(() => api.incidents('building'), []);
  // Neighbours' new reports appear here without reopening the app.
  useEffect(() => { void house.reload(); }, [unread.incidents]); // eslint-disable-line react-hooks/exhaustive-deps
  const news = useLoad(() => api.announcements(), []);
  const residence = me.residence!;
  const place = addressLines(residence.building.street, residence.building.house, residence.apartmentNumber);
  const open = house.data ?? [];
  const latest = news.data?.[0];
  const phone = residence.company.phone.replace(/[^\d+]/g, '');

  return (
    <>
      <div className="house-card">
        <div className="house-card-top">
          <span className="house-card-icon"><Icon name="building" size={24} /></span>
          <div className="house-card-text">
            <span className="house-card-address">{place.main}</span>
            {place.details.map((line) => <span key={line} className="house-card-flat">{line}</span>)}
          </div>
        </div>
        <div className="house-card-company">
          <span>{residence.company.name}</span>
          <a className="house-card-call" href={`tel:${phone}`} aria-label={`Позвонить в УК ${residence.company.phone}`}><Icon name="phone" size={18} /></a>
        </div>
      </div>

      <button type="button" className="report-button" onClick={() => navigation.push({ name: 'new-incident' })}>
        <span className="report-button-icon"><Icon name="plus" size={24} strokeWidth={2.5} /></span>
        <span className="report-button-title">Сообщить о проблеме</span>
      </button>

      <div className="quick-grid">
        <QuickAction icon="megaphone" color="#34c759" title="Объявления" {...(unread.announcements ? { badge: unread.announcements } : {})} onClick={() => navigation.push({ name: 'announcements' })} />
        {/* The house is already chosen: instead of the map, the company of the house. */}
        <QuickAction icon="building" color="#007aff" title="Моя УК" onClick={() => navigation.push({ name: 'company-info' })} />
        <QuickAction icon="calendar" color="#5856d6" title="Запись на приём" onClick={() => navigation.push({ name: 'appointments' })} />
        <QuickAction icon="poll" color="#ff9500" title="Опросы" {...(unread.polls ? { badge: unread.polls } : {})} onClick={() => navigation.switchTab('polls')} />
      </div>
      <Section>
        {residence.building.chatLink ? (
          <CellSimple as="button" onClick={() => window.open(residence.building.chatLink!, '_blank')} before={<IconTile name="chat" color="#007aff" />} title="Чат дома" subtitle="Общий чат жителей в MAX" showChevron />
        ) : (
          <CellSimple before={<IconTile name="chat" color="#8a8f98" />} title="Чат дома пока не создан" subtitle="Когда УК добавит ссылку на чат, он появится здесь" />
        )}
      </Section>

      <Section header="В доме сейчас">
        {open.length ? open.slice(0, 3).map((incident) => (
          <IncidentCell key={incident.id} {...incident} when={incident.updatedAt} onClick={() => navigation.push({ name: 'incident', ref: incident.id })} />
        )) : <CellSimple title={house.loading ? 'Загружаем…' : 'Открытых проблем нет'} subtitle={undefined} />}
        {open.length > 3 ? <CellAction onClick={() => navigation.switchTab('incidents')} showChevron>Все заявки дома</CellAction> : null}
      </Section>

      {latest ? (
        <Section header="Последнее объявление">
          <CellSimple as="button" onClick={() => navigation.push({ name: 'announcements' })} title={<span className="clamp-3">{latest.text}</span>} subtitle={ago(latest.createdAt)} showChevron />
        </Section>
      ) : null}
    </>
  );
}

function PendingJoin() {
  const { me, refresh } = useSession();
  const { showSnackbar } = useSnackbar();
  const pending = me.pendingJoin!;
  return (
    <Empty
      icon="bell"
      title="Ждём подтверждения"
      text={`${pending.address}, кв. ${pending.apartmentNumber}. В квартире уже есть жители — они получили запрос в MAX. Когда кто-то подтвердит, откроются заявки дома. Если никто не ответит, запрос подтвердит УК.`}
      action={(
        <Actions>
          <Button variant="secondary" size="medium" onClick={() => void refresh()}>Проверить</Button>
          <Button variant="ghost" size="medium" onClick={async () => {
            try { await api.cancelJoin(); await refresh(); } catch (error) { showSnackbar({ text: errorText(error) }); }
          }}>Отменить запрос</Button>
        </Actions>
      )}
    />
  );
}

function Welcome() {
  const navigation = useNavigation();
  return (
    <>
      <div className="welcome">
        <span className="welcome-icon"><Icon name="building" size={36} /></span>
        <h2 className="welcome-title">Найдите свой дом</h2>
        <p className="welcome-text">Чтобы писать в управляющую компанию, выберите свой дом.</p>
        <Button size="large" stretched onClick={() => navigation.switchTab('map')}>Открыть карту</Button>
      </div>
      <Section header="Как подключиться">
        <CellSimple before={<span className="step">1</span>} title="Найдите дом на карте" subtitle="и укажите номер квартиры" />
        <CellSimple before={<span className="step">2</span>} title="Введите код дома и квартиры" subtitle="Их выдаёт УК: на доске объявлений, в квитанции или в чате дома" />
        <CellSimple before={<span className="step">3</span>} title="Готово" subtitle="Заявки и объявления УК придут в MAX" />
      </Section>
    </>
  );
}
