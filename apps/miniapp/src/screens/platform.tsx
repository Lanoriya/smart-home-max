import { useState } from 'react';
import { Button, CellAction, CellSimple, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type Invite } from '../api';
import { bridge } from '../bridge';
import { useNavigation, useStepBack } from '../nav';
import { useLoad, useSession } from '../session';
import { Icon, IconTile } from '../components/icons';
import { Actions, Failure, Loading, Page, Section, StatTile } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { CompanyForm, InviteResult, MetricsGrid } from './desk';
import { duration, percent, plural } from '../labels';

// The platform: management companies on the map, their pilot metrics side by
// side, and connecting a new company with an invitation for its administrator.

export function PlatformScreen() {
  const navigation = useNavigation();
  const overview = useLoad(() => api.platform.overview(), []);
  const [adding, setAdding] = useState(false);
  const { showSnackbar } = useSnackbar();
  useStepBack(adding, () => setAdding(false));
  const openWebAdmin = async () => {
    try {
      const { url } = await api.desk.webLink();
      bridge.openLink(url);
      showSnackbar({ text: 'Веб-админка открывается в браузере. Ссылка одноразовая и действует 5 минут.' });
    } catch (error) { showSnackbar({ text: errorText(error) }); }
  };

  if (overview.error) return <Failure text={overview.error} retry={overview.reload} />;
  if (!overview.data) return <Loading />;
  const { total, companies } = overview.data;

  if (adding) {
    return (
      <Page title="Подключить УК" subtitle="После создания отправьте администратору УК приглашение">
        <CompanyForm initial={{}} submitLabel="Создать УК" onSubmit={async (form) => {
          const company = await api.platform.createCompany(form);
          showSnackbar({ text: `«${company.name}» подключена` });
          setAdding(false);
          await overview.reload();
          navigation.push({ name: 'platform-company', companyId: company.id });
        }} />
        <Actions><Button size="medium" variant="ghost" onClick={() => setAdding(false)}>Отмена</Button></Actions>
      </Page>
    );
  }

  return (
    <Page title="Платформа" subtitle={`${companies.length} ${plural(companies.length, 'управляющая компания', 'управляющие компании', 'управляющих компаний')}, ${total.buildings} ${plural(total.buildings, 'дом', 'дома', 'домов')}, ${total.residents} ${plural(total.residents, 'житель', 'жителя', 'жителей')}`}
      after={<Button size="small" onClick={() => setAdding(true)}>+ УК</Button>}>
      <MetricsGrid stats={total} />
      <button type="button" className="report-button" onClick={() => navigation.switchTab('map')}>
        <span className="report-button-icon"><Icon name="pin" size={24} /></span>
        <span className="report-button-title">Подключить дом на карте</span>
      </button>
      <Section>
        <CellSimple as="button" before={<IconTile name="platform" color="#007aff" />} title="Веб-админка на компьютере" subtitle="Все УК, подключения и пульт любой УК в браузере" onClick={() => void openWebAdmin()} showChevron />
        <CellSimple as="button" before={<IconTile name="shield" color="#5856d6" />} title="Обязанности УК" subtitle="Общий текст по законам для всех УК" onClick={() => navigation.push({ name: 'platform-duties' })} showChevron />
        <CellSimple as="button" before={<IconTile name="building" color="#5856d6" />} title="УК и все её дома разом" subtitle="Найти УК в реестре и подключить список её домов" onClick={() => navigation.push({ name: 'platform-bulk' })} showChevron />
      </Section>
      <Section header="Управляющие компании">
        {companies.map((company) => (
          <CellSimple key={company.id} as="button" onClick={() => navigation.push({ name: 'platform-company', companyId: company.id })}
            title={company.name}
            subtitle={`${company.buildingsCount} ${plural(company.buildingsCount, 'дом', 'дома', 'домов')}, открыто ${company.stats.open}, реакция ${duration(company.stats.reactionMinutesMedian)}, в срок ${percent(company.stats.onTimeShare)}`}
            after={company.adminsCount ? undefined : <span className="tag tag-high">нет сотрудников</span>}
            showChevron />
        ))}
      </Section>
    </Page>
  );
}

export function PlatformCompanyScreen({ companyId }: { companyId: string }) {
  const navigation = useNavigation();
  const confirm = useConfirm();
  const { setActing } = useSession();
  const { showSnackbar } = useSnackbar();
  const overview = useLoad(() => api.platform.overview(), [companyId]);
  const [editing, setEditing] = useState(false);
  useStepBack(editing, () => setEditing(false));
  const [invite, setInvite] = useState<Invite | null>(null);
  if (overview.error) return <Failure text={overview.error} retry={overview.reload} />;
  if (!overview.data) return <Loading />;
  const company = overview.data.companies.find((item) => item.id === companyId);
  if (!company) return <Failure text="УК не найдена" />;

  if (editing) {
    return (
      <Page title="Карточка УК">
        <CompanyForm initial={company} submitLabel="Сохранить" onSubmit={async (form) => {
          await api.platform.updateCompany(company.id, form);
          showSnackbar({ text: 'Сохранено' });
          setEditing(false);
          await overview.reload();
        }} />
      </Page>
    );
  }

  const createInvite = async () => {
    try { setInvite(await api.platform.invite(company.id, 'supervisor')); } catch (error) { showSnackbar({ text: errorText(error) }); }
  };

  return (
    <Page title={company.name} subtitle={`${company.phone}, сотрудников ${company.adminsCount}`}>
      <div className="stats">
        <StatTile value={company.buildingsCount} label={plural(company.buildingsCount, 'дом', 'дома', 'домов')} />
        <StatTile value={company.apartmentsCount} label={plural(company.apartmentsCount, 'квартира', 'квартиры', 'квартир')} />
        <StatTile value={company.entrancesCount} label={plural(company.entrancesCount, 'подъезд', 'подъезда', 'подъездов')} />
        <StatTile value={company.stats.residents} label={`${plural(company.stats.residents, 'житель', 'жителя', 'жителей')} в сервисе`} tone="accent" />
      </div>
      <MetricsGrid stats={company.stats} />
      <CompanyStaff companyId={company.id} onChanged={() => void overview.reload()} />
      <Actions>
        <Button size="medium" variant="destructive" stretched onClick={async () => {
          // A company with houses goes together with them, after a plain
          // warning of what is lost; houses to keep are handed over first.
          const houses = company.buildingsCount;
          const text = houses
            ? `Удалить «${company.name}» вместе с ${houses} ${plural(houses, 'домом', 'домами', 'домами')}? Удалятся квартиры и заявки этих домов, ${company.stats.residents} ${plural(company.stats.residents, 'житель будет отключён', 'жителя будут отключены', 'жителей будут отключены')}, сотрудники потеряют доступ. Дома, которые нужно сохранить, сначала передайте другой УК.`
            : `Удалить «${company.name}»? Её объявления, службы и приглашения удалятся, сотрудники потеряют доступ.`;
          if (!await confirm({ text, confirm: houses ? 'Удалить УК и дома' : 'Удалить УК', destructive: true })) return;
          try { await api.platform.deleteCompany(company.id, houses > 0); showSnackbar({ text: houses ? 'УК и её дома удалены' : 'УК удалена' }); navigation.back(); } catch (error) { showSnackbar({ text: errorText(error) }); }
        }}>Удалить УК</Button>
      </Actions>
      <Section>
        <CellAction before={<IconTile name="desk" color="#5856d6" />} onClick={() => { setActing({ id: company.id, name: company.name }); navigation.push({ name: 'desk' }); }} showChevron>Открыть пульт этой УК</CellAction>
        <CellAction before={<IconTile name="building" color="#5856d6" />} onClick={() => navigation.push({ name: 'platform-bulk', companyId: company.id })} showChevron>Добавить дома списком</CellAction>
        <CellAction before={<IconTile name="edit" color="#8a8f98" />} onClick={() => setEditing(true)} showChevron>Изменить карточку и точку офиса</CellAction>
      </Section>
      <Actions>
        <Button size="large" stretched onClick={() => void createInvite()}>Пригласить администратора УК</Button>
      </Actions>
      {invite ? <InviteResult invite={invite} companyName={company.name} /> : null}
    </Page>
  );
}

// Employees of the company: the platform administrator takes the access away
// from someone who left. Their past actions stay in the history.
function CompanyStaff({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const { showSnackbar } = useSnackbar();
  const staff = useLoad(() => api.platform.admins(companyId), [companyId]);
  const confirm = useConfirm();
  const remove = async (id: string, name: string) => {
    if (!await confirm({ text: `Удалить ${name} из сотрудников УК? Доступ к пульту пропадёт сразу.`, confirm: 'Удалить', destructive: true })) return;
    try {
      await api.platform.removeAdmin(id);
      bridge.haptic('success');
      showSnackbar({ text: `${name} больше не сотрудник УК` });
      await staff.reload();
      onChanged();
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    }
  };
  if (!staff.data) return null;
  return (
    <Section header={`Сотрудники: ${staff.data.length}`}>
      {staff.data.length ? staff.data.map((person) => (
        <CellSimple key={person.id} before={<IconTile name="people" color="#5856d6" />} title={person.name}
          subtitle={person.viaMax ? 'Входит через MAX' : 'Входит в веб-пульт по паролю'}
          after={<Button size="small" variant="secondary" onClick={() => void remove(person.id, person.name)}>Удалить</Button>} />
      )) : <CellSimple subtitle="Сотрудников пока нет — пригласите администратора УК." />}
    </Section>
  );
}
