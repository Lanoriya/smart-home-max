import { useEffect, useMemo, type ReactNode } from 'react';
import { ThemeProvider } from './theme';
import { MaxUI, SnackbarProvider } from '@maxhub/max-ui';
import { bridge } from './bridge';
import { NavigationProvider, useNavigation, type Screen, type Tab } from './nav';
import { SessionProvider, useSession } from './session';
import { Failure, Loading } from './components/ui';
import { HomeScreen } from './screens/home';
import { MapScreen, JoinHouseScreen } from './screens/map';
import { IncidentsScreen, IncidentScreen } from './screens/incidents';
import { NewIncidentScreen } from './screens/new-incident';
import { MoreScreen, AnnouncementsScreen, ContactsScreen, CompanyInfoScreen, InviteScreen } from './screens/more';
import { DeskScreen, DeskIncidentsScreen, DeskTeamScreen, DeskCompanyScreen, DeskBroadcastScreen, DeskAnnouncementsScreen, DeskJoinsScreen, DeskStatsScreen } from './screens/desk';
import { DeskServicesScreen } from './screens/desk-services';
import { DeskDutiesScreen, DutiesScreen, PlatformDutiesScreen } from './screens/duties';
import { DeskIncidentScreen } from './screens/desk-incident';
import { DeskHousesScreen, DeskApartmentsScreen } from './screens/desk-houses';
import { PlatformScreen, PlatformCompanyScreen } from './screens/platform';
import { PlatformConnectScreen } from './screens/platform-connect';
import { PlatformBulkScreen } from './screens/platform-bulk';
import { HelpScreen } from './screens/help';
import { ConfirmProvider } from './components/confirm';
import { UnreadProvider, useUnread } from './unread';
import { api } from './api';
import { NeighboursScreen } from './screens/neighbours';
import { Icon, type IconName } from './components/icons';
import { PrivacyScreen } from './screens/privacy';
import { DeskPollNewScreen, DeskPollsScreen, PollsScreen } from './screens/polls';
import { AppointmentsScreen, DeskAppointmentsScreen } from './screens/appointments';

export function App() {
  useEffect(() => { bridge.ready(); }, []);
  return (
    <ThemeProvider>
      {(colorScheme) => (
        <MaxUI platform={bridge.platform} colorScheme={colorScheme} className="app-root">
          <SnackbarProvider defaultPlacement="top-center">
            <ConfirmProvider>
            <SessionProvider fallback={({ error, retry }) => (error ? <Failure text={error} retry={retry} /> : <Loading />)}>
              <Shell />
            </SessionProvider>
            </ConfirmProvider>
          </SnackbarProvider>
        </MaxUI>
      )}
    </ThemeProvider>
  );
}

// Where a link from the bot leads: "incident_42", "desk_42", "invite_…",
// "map", "announcements".
function entryFor(startParam: string | null, hasDesk: boolean, isPlatform: boolean): { tab: Tab; stack?: Screen[] } {
  // The platform administrator runs companies and does not live in the app as
  // a resident: their app opens on the list of companies.
  if (isPlatform) {
    if (startParam === 'connect' || startParam === 'map') return { tab: 'map' };
    if (startParam === 'help') return { tab: 'more', stack: [{ name: 'more' }, { name: 'help' }] };
    return { tab: 'platform' };
  }
  if (!startParam) return { tab: 'home' };
  if (startParam.startsWith('invite_')) return { tab: 'home', stack: [{ name: 'home' }, { name: 'invite', token: startParam }] };
  const incident = /^incident_(\d+)$/.exec(startParam);
  if (incident) return { tab: 'incidents', stack: [{ name: 'incidents' }, { name: 'incident', ref: Number(incident[1]) }] };
  const desk = /^desk_(\d+)$/.exec(startParam);
  if (desk && hasDesk) return { tab: 'desk', stack: [{ name: 'desk' }, { name: 'desk-incident', id: `number:${desk[1]}` }] };
  if (startParam === 'map') return { tab: 'map' };
  const house = /^house_([0-9a-f-]{36})$/.exec(startParam);
  if (house) return { tab: 'map', stack: [{ name: 'map', focusBuildingId: house[1]! }] };
  if (startParam === 'neighbours') return { tab: 'neighbours' };
  if (startParam === 'polls' || /^poll_[0-9a-f-]{36}$/.test(startParam)) return { tab: 'polls' };
  if (startParam === 'appointments') return { tab: 'home', stack: [{ name: 'home' }, { name: 'appointments' }] };
  if (startParam === 'desk_appointments' && hasDesk) return { tab: 'desk', stack: [{ name: 'desk' }, { name: 'desk-appointments' }] };
  if (startParam === 'services' || startParam === 'contacts') return { tab: 'services' };
  if (startParam === 'help') return { tab: 'more', stack: [{ name: 'more' }, { name: 'help' }] };
  if (startParam === 'desk' && hasDesk) return { tab: 'desk' };
  if (startParam === 'announcements') return { tab: 'more', stack: [{ name: 'more' }, { name: 'announcements' }] };
  return { tab: 'home' };
}

function Shell() {
  const { me, mode, setMode, canSwitchMode } = useSession();
  const hasDesk = Boolean(me.admin);
  const isPlatform = me.admin?.role === 'platform_admin';
  // The start parameter is read once: later visits to tabs start from their roots.
  const entry = useMemo(() => {
    const found = entryFor(bridge.startParam, hasDesk, isPlatform && mode === 'platform');
    if (!canSwitchMode || bridge.startParam) return found;
    return mode === 'company' ? { tab: 'desk' as Tab } : mode === 'platform' ? { tab: 'platform' as Tab } : found;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A link to a company screen opens the app as the company.
  useEffect(() => { if (canSwitchMode && entry.tab.startsWith('desk')) setMode('company'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <NavigationProvider initialTab={entry.tab} {...(entry.stack ? { initialStack: entry.stack } : {})}>
      <UnreadProvider>
        <main className="app-main"><AnimatedScreen /></main>
        <TabBar mode={mode} hasResidence={Boolean(me.residence)} />
      </UnreadProvider>
    </NavigationProvider>
  );
}

// Each new screen slides in; the key restarts the animation on navigation.
function AnimatedScreen() {
  const { screen, tab, depth } = useNavigation();
  return <div key={`${tab}-${depth}-${screen.name}`} className="screen-enter"><CurrentScreen /></div>;
}

function CurrentScreen() {
  const { screen } = useNavigation();
  const { mode } = useSession();
  switch (screen.name) {
    case 'home': return <HomeScreen />;
    case 'map': return mode === 'platform' ? <PlatformConnectScreen /> : <MapScreen {...(screen.focusBuildingId ? { focusBuildingId: screen.focusBuildingId } : {})} />;
    case 'incidents': return <IncidentsScreen />;
    case 'incident': return <IncidentScreen key={String(screen.ref)} reference={screen.ref} />;
    case 'new-incident': return <NewIncidentScreen />;
    case 'join-house': return <JoinHouseScreen buildingId={screen.buildingId} address={screen.address} change={Boolean(screen.change)} />;
    case 'more': return <MoreScreen />;
    case 'neighbours': return <NeighboursScreen />;
    case 'polls': return <PollsScreen />;
    case 'appointments': return <AppointmentsScreen />;
    case 'desk-polls': return <DeskPollsScreen />;
    case 'desk-poll-new': return <DeskPollNewScreen />;
    case 'desk-appointments': return <DeskAppointmentsScreen />;
    case 'desk-stats': return <DeskStatsScreen />;
    case 'desk-joins': return <DeskJoinsScreen />;
    case 'services': return <ContactsScreen />;
    case 'announcements': return <AnnouncementsScreen />;
    case 'contacts': return <ContactsScreen />;
    case 'company-info': return <CompanyInfoScreen />;
    case 'duties': return <DutiesScreen />;
    case 'privacy': return <PrivacyScreen />;
    case 'desk-duties': return <DeskDutiesScreen />;
    case 'platform-duties': return <PlatformDutiesScreen />;
    case 'invite': return <InviteScreen token={screen.token} />;
    case 'desk': return <DeskScreen />;
    case 'desk-incidents': return <WithCompany><DeskIncidentsScreen {...(screen.status ? { initialStatus: screen.status } : {})} /></WithCompany>;
    case 'desk-incident': return <DeskIncidentScreen key={screen.id} reference={screen.id} />;
    case 'desk-houses': return <WithCompany><DeskHousesScreen /></WithCompany>;
    case 'desk-apartments': return <DeskApartmentsScreen buildingId={screen.buildingId} address={screen.address} />;
    case 'desk-announcements': return <DeskAnnouncementsScreen />;
    case 'desk-broadcast': return <DeskBroadcastScreen {...(screen.buildingId ? { buildingId: screen.buildingId } : {})} />;
    case 'desk-team': return <DeskTeamScreen />;
    case 'desk-company': return <DeskCompanyScreen />;
    case 'desk-services': return <DeskServicesScreen />;
    case 'platform': return <PlatformScreen />;
    case 'platform-company': return <PlatformCompanyScreen companyId={screen.companyId} />;
    case 'help': return <HelpScreen {...(screen.role ? { initialRole: screen.role } : {})} />;
    case 'platform-bulk': return <PlatformBulkScreen {...(screen.companyId ? { companyId: screen.companyId } : {})} />;
    case 'platform-connect': return <PlatformConnectScreen {...(screen.point ? { point: screen.point } : {})} />;
  }
}

// The platform administrator opens a company tab before choosing a company:
// the choice of the company comes first, as on the "Пульт" tab.
function WithCompany({ children }: { children: ReactNode }) {
  const { me, acting } = useSession();
  if (!acting && me.admin?.role === 'platform_admin') return <DeskScreen />;
  return <>{children}</>;
}

const tabIcons: Record<Tab, IconName> = { home: 'home', map: 'map', incidents: 'incidents', neighbours: 'people', polls: 'poll', services: 'siren', desk: 'desk', 'desk-incidents': 'incidents', 'desk-houses': 'building', platform: 'platform', more: 'more' };

function TabBar({ mode, hasResidence }: { mode: 'resident' | 'company' | 'platform'; hasResidence: boolean }) {
  const { tab, switchTab } = useNavigation();
  const tabs: Array<{ id: Tab; title: string }> = mode === 'platform'
    ? [
      { id: 'platform', title: 'Компании' },
      { id: 'map', title: 'Карта' },
      { id: 'more', title: 'Ещё' },
    ]
    : mode === 'company'
    ? [
      { id: 'desk', title: 'Пульт' },
      { id: 'desk-incidents', title: 'Заявки' },
      { id: 'desk-houses', title: 'Дома' },
      { id: 'more', title: 'Ещё' },
    ]
    : [
      { id: 'home', title: 'Главная' },
      // Without a house the map is where everything starts; with a house the
      // map stays on the home screen, and the tab gives way to the house tabs.
      ...(hasResidence
        ? [{ id: 'incidents' as const, title: 'Заявки' }, { id: 'neighbours' as const, title: 'Соседи' }, { id: 'polls' as const, title: 'Опросы' }]
        : [{ id: 'map' as const, title: 'Карта' }]),
      { id: 'services', title: 'Службы' },
      { id: 'more', title: 'Ещё' },
    ];
  // A dot on a tab with something not seen yet; opening the incidents marks
  // their updates as seen.
  const unread = useUnread();
  const dotOn: Partial<Record<Tab, boolean>> = { incidents: unread.incidents > 0, home: unread.announcements > 0, polls: unread.polls > 0 };
  // An unresolved emergency: an exclamation mark, it outweighs the dot.
  // Only the company sees the exclamation mark: it is the one to step in.
  const alarmOn: Partial<Record<Tab, boolean>> = { 'desk-incidents': mode === 'company' && unread.emergencies > 0 };
  useEffect(() => {
    if (tab === 'incidents' && unread.incidents > 0) void api.incidentsSeen().then(unread.refresh).catch(() => undefined);
  }, [tab, unread.incidents]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <nav className="tabbar" aria-label="Разделы">
      {tabs.map((item) => (
        <button key={item.id} type="button" className={`tabbar-item${item.id === tab ? ' tabbar-item-active' : ''}`} aria-current={item.id === tab ? 'page' : undefined} onClick={() => { switchTab(item.id); void unread.refresh(); }}>
          <span className="tabbar-icon"><Icon name={tabIcons[item.id]} size={24} strokeWidth={item.id === tab ? 2.3 : 1.8} />{alarmOn[item.id] ? <i className="tabbar-alarm" aria-label="Есть нерешённая авария">!</i> : dotOn[item.id] ? <i className="tabbar-dot" aria-label="Есть непрочитанное" /> : null}</span>
          <span className="tabbar-title">{item.title}</span>
        </button>
      ))}
    </nav>
  );
}
