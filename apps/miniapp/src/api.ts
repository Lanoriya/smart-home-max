import { bridge, devUserId, readLinkToken } from './bridge';

// Client of /api/app. Every request carries the signed launch data of MAX; the
// backend recognises the person and their role from it.

export type Role = 'dispatcher' | 'supervisor' | 'platform_admin';
export type Status = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected';
export type Category = 'water' | 'electricity' | 'heating' | 'elevator' | 'leak' | 'cleaning' | 'other';
export type Zone = 'entrance' | 'elevator' | 'yard' | 'common' | 'apartment';
export type Priority = 'low' | 'normal' | 'high' | 'emergency';

export type Company = {
  id: string; name: string; phone: string; email?: string | null; address?: string | null; workingHours?: string | null; note?: string | null;
  receptionHours?: string | null; daysOff?: string | null; cleaningInfo?: string | null;
  inn?: string | null; ogrn?: string | null; site?: string | null; latitude?: number | null; longitude?: number | null;
};

export type Me = {
  user: { id: string; displayName: string | null; username: string | null; phone: string | null; consent: boolean };
  residence: null | {
    apartmentId: string; apartmentNumber: string;
    building: { id: string; address: string; street: string; house: string; entrancesCount: number; chatLink: string | null; latitude: number | null; longitude: number | null };
    company: Company;
    timeZone: string;
  };
  pendingJoin: null | { address: string; apartmentNumber: string; createdAt: string };
  admin: null | { role: Role; company: { id: string; name: string } | null; timeZone: string | null; legalReminders: boolean };
  botUsername: string | null;
};

export type MapData = {
  companies: Array<Company & { buildingsCount: number }>;
  buildings: Array<{ id: string; address: string; companyId: string; latitude: number | null; longitude: number | null; openIssues: number }>;
};

export type BuildingCard = {
  id: string; address: string; entrancesCount: number; apartmentsCount: number; latitude: number | null; longitude: number | null;
  company: Company; connectedApartments: number; isResident: boolean;
  openIssues: Array<{ id: string; number: number; title: string | null; category: Category; locationZone: Zone; entranceNumber: number | null; status: Status; createdAt: string; reportsCount: number }>;
};

export type IncidentSummary = {
  id: string; number: number; title: string; category: Category; locationZone: Zone; entranceNumber: number | null; status: Status; priority: Priority;
  dueAt: string | null; address: string; reportsCount: number; commentsCount: number; joined: boolean; archived: boolean; createdAt: string; updatedAt: string;
  timeZone: string;
};

export type IncidentDetail = {
  id: string; number: number; title: string; category: Category; locationZone: Zone; entranceNumber: number | null; apartmentNumber: string | null;
  status: Status; priority: Priority; dueAt: string | null; delayReason: string | null; rejectionReason: string | null; address: string;
  createdAt: string; resolvedAt: string | null; reportsCount: number; myDescription: string | null; legalTerm: LegalTerm; timeZone: string;
  joined: boolean; canJoin: boolean; canCancel: boolean; canComment: boolean; byPhone: boolean;
  feedback: { canAnswer: boolean; until: string | null; answer: { resolved: boolean; rating: number | null; comment: string | null; at: string } | null };
  timeline: Array<{ at: string; status: Status | null; comment: string | null; dueAt: string | null; delayReason: string | null }>;
  comments: Array<{ id: string; text: string; createdAt: string; apartmentNumber: string | null; mine: boolean }>;
  photos: Array<{ id: string; url: string }>;
};

export type Similar = { id: string; number: number; title: string; status: Status; reportsCount: number; createdAt: string };
export type Announcement = { id: string; audience: 'all' | 'street' | 'building' | 'apartment'; text: string; createdAt: string; read: boolean };
export type DeskAnnouncement = { id: string; audience: 'all' | 'street' | 'building' | 'apartment'; street: string | null; text: string; recipientsCount: number; createdAt: string; archivedAt: string | null; building: { address: string } | null; apartment: { number: string; building: { address: string } } | null; admin: { username: string } };
export type MyCars = { items: Array<{ id: string; plate: string; owner: string | null; phones: string[] }>; showPhone: boolean; sharedPhone: string | null; limit: number };
export type DeskApartment = { id: string; number: string; hasCode: boolean; contractNumber: string; residents: number; people: string[] };
export type CarMatch = { id: string; plate: string; mine: boolean; owner: string | null; phones: string[]; address: string | null; canMessage: boolean };
export type EmergencyService = { id: string; name: string; phone: string; description: string };
export type QuickDialItem = { number: string; title: string };
export type PollOption = { id: string; text: string; count?: number; apartments?: string[] };
export type Poll = {
  id: string; question: string; scope: string; buildingId: string | null; anonymous: boolean; allowChange: boolean;
  endsAt: string; closedAt: string | null; createdAt: string; active: boolean; votes: number; timeZone: string; zoneLabel: string;
  myOptionId: string | null; canVote: boolean; showResults: boolean; options: PollOption[];
};
export type Slot = { id: string; startsAt: string; durationMinutes: number };
export type DeskSlot = Slot & { topic: string | null; booked: boolean; resident: { name: string | null; phone: string | null; address: string | null } | null };
export type DutyBlock = { title: string; source: string; items: string[] };
// The longest term the law gives the company for an incident.
export type LegalTerm = { title: string; dueAt: string; firstStep: string | null; source: string };
type ServiceBody = { name: string; phone: string; description: string };

export type Stats = {
  periodDays: number; incidents: number; reports: number; duplicatesAvoided: number; duplicateShare: number | null;
  open: number; newOnes: number; overdue: number; reactionMinutesMedian: number | null; resolveHoursMedian: number | null;
  onTimeShare: number | null; residents: number; buildings: number; buildingsOnMap: number;
  topCategories: Array<{ category: Category; count: number }>;
  resolvedCount: number; confirmedShare: number | null; acceptedShare: number | null; silentCount: number; pendingCount: number; confirmedCount: number; reopenedCount: number; ratingAverage: number | null; ratingsCount: number; phoneIncidents: number;
};

export type DeskIncident = {
  id: string; number: number; title: string; category: Category; locationZone: Zone; entranceNumber: number | null; apartmentNumber: string | null;
  status: Status; priority: Priority; buildingId: string; address: string; latitude: number | null; longitude: number | null;
  reportsCount: number; commentsCount: number; dueAt: string | null; createdAt: string; updatedAt: string; version: number; timeZone: string;
};

export type DeskIncidentDetail = {
  id: string; number: number; title: string; category: Category; locationZone: Zone; entranceNumber: number | null; apartmentNumber: string | null;
  status: Status; priority: Priority; dueAt: string | null; delayReason: string | null; rejectionReason: string | null; version: number;
  createdAt: string; building: { address: string }; legalTerm: LegalTerm; timeZone: string;
  source: 'resident' | 'phone'; callerName: string | null; callerPhone: string | null; callNote: string | null;
  feedback: Array<{ id: string; resolved: boolean; rating: number | null; comment: string | null; updatedAt: string; apartment: { number: string } | null }>;
  feedbackSummary: { confirmed: number; returned: number; ratingAverage: number | null };
  acceptance: { state: 'confirmed' | 'silent' | 'waiting'; until: string } | null;
  reports: Array<{ id: string; description: string; createdAt: string; apartment: { number: string } | null; author: { displayName: string | null } }>;
  events: Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt: string }>;
  comments: Array<{ id: string; text: string; createdAt: string; apartment: { number: string } | null }>;
  photos: Array<{ id: string; url: string | null }>;
};

export type DeskBuilding = {
  id: string; address: string; street: string; house: string; entrancesCount: number; apartmentsCount: number;
  latitude: number | null; longitude: number | null; chatLink: string | null; connectedApartments: number; openIncidents: number;
};

export type Invite = { startParam: string; link: string | null; expiresAt: string; role: 'dispatcher' | 'supervisor' };

export type LookupSource = 'map' | 'registry' | 'service';
export type HouseLookup = {
  point: { latitude: number; longitude: number };
  address: { street: string; house: string; locality: string | null; region: string | null; display: string } | null;
  details: { floors: number | null; apartments: number | null; builtYear: number | null; residents: number | null; totalArea: number | null; fiasGuid: string | null };
  filled: Record<string, LookupSource>;
  existing: { id: string; address: string; company: { id: string; name: string } } | null;
  registryAddress: string | null;
};

export type CitySuggestion = { name: string; region: string | null; latitude: number; longitude: number; extent?: [number, number, number, number] | null };

function cityParams(city: CitySuggestion): Record<string, string> {
  return {
    city: city.name, lat: String(city.latitude), lng: String(city.longitude),
    ...(city.region ? { region: city.region } : {}),
    ...(city.extent ? { extent: city.extent.join(',') } : {}),
  };
}
export type AddressSuggestion = { street: string; house: string | null; city: string | null; region: string | null; latitude: number; longitude: number };

export type RegistryCompany = {
  id: string; subject: string; nameFull: string; nameShort: string | null; inn: string | null; ogrn: string | null;
  legalAddress: string | null; actualAddress: string | null; phone: string | null; email: string | null; site: string | null;
  housesCount: number | null; connectedCompanyId: string | null;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown> = {}) {
    super(code);
  }
}

// The company a platform administrator currently acts for.
let actingCompanyId: string | null = null;
export function actAsCompany(companyId: string | null) {
  actingCompanyId = companyId;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const link = bridge.initData ? null : readLinkToken();
  if (bridge.initData) headers.authorization = `MaxWebApp ${bridge.initData}`;
  else if (link) headers.authorization = `MaxLink ${link}`;
  else {
    const dev = devUserId();
    if (dev) headers['x-dev-max-user-id'] = dev;
  }
  if (actingCompanyId) headers['x-company-id'] = actingCompanyId;
  let response: Response;
  try {
    response = await fetch(`/api/app${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, typeof data.code === 'string' ? data.code : 'error', data);
  return data as T;
}

export const api = {
  me: () => request<Me>('GET', '/me'),
  map: () => request<MapData>('GET', '/map'),
  building: (id: string) => request<{ item: BuildingCard }>('GET', `/buildings/${id}`).then((data) => data.item),
  bindResidence: (body: { buildingId: string; apartmentNumber: string; buildingCode?: string; apartmentCode?: string; contractNumber?: string; consent?: boolean }) =>
    request<{ status: 'bound' | 'join_requested' | 'apartment_code_required'; notified?: number }>('POST', '/residence', body),
  leaveResidence: () => request<{ apartmentId: string | null; canClearData: boolean }>('DELETE', '/residence'),
  clearPreviousApartment: (apartmentId: string) => request<void>('POST', '/residence/clear', { apartmentId }),
  cancelJoin: () => request<void>('DELETE', '/join-request'),
  incidents: (scope: 'mine' | 'building' | 'archive') => request<{ items: IncidentSummary[] }>('GET', `/incidents?scope=${scope}`).then((data) => data.items),
  incident: (ref: string | number) => request<{ item: IncidentDetail }>('GET', `/incidents/${ref}`).then((data) => data.item),
  similar: (draft: DraftInput) => request<{ items: Similar[] }>('POST', '/incidents/similar', draft).then((data) => data.items),
  createIncident: (draft: DraftInput & { description: string; priority?: 'normal' | 'high' | 'emergency'; photos?: string[] }) => request<{ item: { id: string; number: number } }>('POST', '/incidents', draft).then((data) => data.item),
  joinIncident: (id: string) => request<{ alreadyJoined: boolean }>('POST', `/incidents/${id}/join`),
  cancelIncident: (id: string, deleteComments = false) => request<{ reportsLeft: number; commentsDeleted: number }>('POST', `/incidents/${id}/cancel`, { deleteComments }),
  deleteComment: (id: string, commentId: string) => request<void>('DELETE', `/incidents/${id}/comments/${commentId}`),
  comment: (id: string, text: string) => request<unknown>('POST', `/incidents/${id}/comments`, { text }),
  feedback: (id: string, answer: { resolved: true; rating?: number } | { resolved: false; comment?: string }) => request<{ reopened: boolean }>('POST', `/incidents/${id}/feedback`, answer),
  announcements: () => request<{ items: Announcement[] }>('GET', '/announcements').then((data) => data.items),
  markAnnouncementsRead: (ids?: string[]) => request<void>('POST', '/announcements/read', ids ? { ids } : {}),
  unread: () => request<{ incidents: number; announcements: number; emergencies: number; polls: number }>('GET', '/unread'),
  polls: () => request<{ items: Poll[] }>('GET', '/polls').then((data) => data.items),
  vote: (pollId: string, optionId: string) => request<{ item: Poll }>('POST', `/polls/${pollId}/vote`, { optionId }).then((data) => data.item),
  appointments: () => request<{ company: { name: string; address: string | null; receptionHours: string | null; phone: string } | null; free: Slot[]; mine: Array<Slot & { topic: string | null }>; limit: number; timeZone: string }>('GET', '/appointments'),
  book: (slotId: string, topic: string) => request<{ startsAt: string }>('POST', `/appointments/${slotId}/book`, { topic }),
  cancelBooking: (slotId: string) => request<void>('DELETE', `/appointments/${slotId}/booking`),
  incidentsSeen: () => request<void>('POST', '/incidents/seen'),
  carSearch: (plate: string) => request<{ items: CarMatch[] }>('POST', '/neighbours/car-search', { plate }).then((data) => data.items),
  messageCarOwner: (vehicleId: string, text: string) => request<{ plate: string }>('POST', '/neighbours/car-message', { vehicleId, text }),
  messageApartment: (apartmentNumber: string, text: string) => request<{ apartmentNumber: string }>('POST', '/neighbours/message', { apartmentNumber, text }),
  myCars: () => request<MyCars>('GET', '/neighbours/cars'),
  addCar: (body: { plate: string; owner?: string; phone?: string }) => request<{ id: string; plate: string }>('POST', '/neighbours/cars', body),
  removeCar: (id: string) => request<void>('DELETE', `/neighbours/cars/${id}`),
  updateCar: (id: string, body: { owner?: string; phone?: string }) => request<void>('PATCH', `/neighbours/cars/${id}`, body),
  setPhoneVisibility: (show: boolean) => request<{ showPhone: boolean }>('PUT', '/neighbours/phone-visibility', { show }),
  duties: () => request<{ items: DutyBlock[]; own: boolean }>('GET', '/duties'),
  contacts: () => request<{ company: Company | null; emergencyServices: EmergencyService[]; quickDial: QuickDialItem[] }>('GET', '/contacts'),
  invite: (token: string) => request<{ item: { role: Role; company: { id: string; name: string }; used: boolean; expired: boolean } }>('GET', `/invites/${encodeURIComponent(token)}`).then((data) => data.item),
  geoCities: (q: string) => request<{ items: CitySuggestion[] }>('GET', `/geo/cities?${new URLSearchParams({ q })}`).then((data) => data.items),
  geoAddresses: (q: string, city: CitySuggestion | null) => request<{ items: AddressSuggestion[] }>('GET', `/geo/addresses?${new URLSearchParams({ q, ...(city ? cityParams(city) : {}) })}`).then((data) => data.items),
  geoLocate: (q: string) => request<{ item: { latitude: number; longitude: number } }>('GET', `/geo/locate?${new URLSearchParams({ q })}`).then((data) => data.item),
  geoResolve: (q: string, city: CitySuggestion) => request<{ item: AddressSuggestion }>('GET', `/geo/resolve?${new URLSearchParams({ q, ...cityParams(city) })}`).then((data) => data.item),
  lookup: (point: { latitude: number; longitude: number }) => request<HouseLookup>('POST', '/lookup', point),
  registryCompanies: (q: string, subject?: string | null) => request<{ items: RegistryCompany[] }>('GET', `/registry/companies?${new URLSearchParams({ q, ...(subject ? { subject } : {}) })}`).then((data) => data.items),
  acceptInvite: (token: string) => request<{ ok: true; role: Role; company: { id: string; name: string } }>('POST', '/invites/accept', { token }),

  desk: {
    overview: () => request<{ company: Company; stats: Stats; pendingJoins: number; role: Role; timeZone: string }>('GET', '/company/overview'),
    webLink: () => request<{ url: string }>('POST', '/company/web-link'),
    leave: () => request<void>('POST', '/company/leave'),
    setLegalReminders: (enabled: boolean) => request<{ enabled: boolean }>('PUT', '/company/legal-reminders', { enabled }),
    polls: () => request<{ items: Array<Poll & { apartmentsTotal: number }> }>('GET', '/company/polls').then((data) => data.items),
    createPoll: (body: { question: string; options: string[]; buildingId: string | null; endsAt: string; anonymous: boolean; allowChange: boolean }) => request<{ id: string; recipients: number }>('POST', '/company/polls', body),
    closePoll: (id: string) => request<void>('POST', `/company/polls/${id}/close`),
    deletePoll: (id: string) => request<void>('DELETE', `/company/polls/${id}`),
    appointments: () => request<{ items: DeskSlot[]; timeZone: string }>('GET', '/company/appointments'),
    createSlots: (starts: string[], durationMinutes: number) => request<{ created: number; skipped: number }>('POST', '/company/appointments', { starts, durationMinutes }),
    deleteSlot: (id: string) => request<void>('DELETE', `/company/appointments/${id}`),
    duties: () => request<{ items: DutyBlock[]; own: boolean; platform: DutyBlock[] }>('GET', '/company/duties'),
    saveDuties: (items: DutyBlock[] | null) => request<{ items: DutyBlock[]; own: boolean }>('PUT', '/company/duties', { items }),
    services: () => request<{ quickDial: QuickDialItem[]; customQuickDial: boolean; items: EmergencyService[] }>('GET', '/company/services'),
    saveQuickDial: (items: QuickDialItem[] | null) => request<{ quickDial: QuickDialItem[] }>('PUT', '/company/quick-dial', { items }),
    addService: (body: ServiceBody) => request<{ item: EmergencyService }>('POST', '/company/services', body),
    updateService: (id: string, body: ServiceBody) => request<{ item: EmergencyService }>('PATCH', `/company/services/${id}`, body),
    deleteService: (id: string) => request<void>('DELETE', `/company/services/${id}`),
    setChatLink: (id: string, chatLink: string | null) => request<{ chatLink: string | null }>('PATCH', `/company/buildings/${id}/chat`, { chatLink }),
    setBuildingCode: (id: string, code: string) => request<{ code: string }>('PATCH', `/company/buildings/${id}/code`, { code }),
    apartments: (buildingId: string, q: string, offset = 0) => request<{ total: number; items: DeskApartment[] }>('GET', `/company/buildings/${buildingId}/apartments?${new URLSearchParams({ q, offset: String(offset) })}`),
    setApartmentCodes: (id: string, body: { code?: string | null; contractNumber?: string }) => request<void>('PATCH', `/company/apartments/${id}`, body),
    incidents: (query: Record<string, string>) => request<{ items: DeskIncident[] }>('GET', `/company/incidents?${new URLSearchParams(query)}`).then((data) => data.items),
    incident: (id: string) => request<{ item: DeskIncidentDetail }>('GET', `/company/incidents/${id}`).then((data) => data.item),
    updateIncident: (id: string, patch: Record<string, unknown>) => request<{ item: { version: number } }>('PATCH', `/company/incidents/${id}`, patch),
    buildings: () => request<{ items: DeskBuilding[] }>('GET', '/company/buildings').then((data) => data.items),
    createBuilding: (body: { street: string; house: string; apartmentsCount: number; entrancesCount: number; latitude: number; longitude: number; fiasGuid?: string | null; floors?: number | null; builtYear?: number | null; city?: string | null }) =>
      request<{ item: DeskBuilding; accessCode: string }>('POST', '/company/buildings', body),
    moveBuilding: (id: string, point: { latitude: number; longitude: number }) => request<unknown>('PATCH', `/company/buildings/${id}/location`, point),
    residentLink: (id: string) => request<{ link: string; address: string; companyName: string; companyPhone: string }>('GET', `/company/buildings/${id}/resident-link`),
    buildingCode: (id: string) => request<{ code: string }>('GET', `/company/buildings/${id}/code`).then((data) => data.code),
    announcements: (archived: boolean, page: number) => request<{ items: DeskAnnouncement[]; total: number; page: number; pageSize: number; counts: { current: number; archived: number } }>('GET', `/company/announcements?archived=${archived}&page=${page}`),
    archiveAnnouncement: (id: string, archived: boolean) => request<void>('POST', `/company/announcements/${id}/${archived ? 'archive' : 'restore'}`),
    deleteAnnouncement: (id: string) => request<void>('DELETE', `/company/announcements/${id}`),
    announce: (body: { audience: 'all' | 'building' | 'apartment'; buildingId?: string; apartmentId?: string; text: string }) => request<{ recipientsCount: number }>('POST', '/company/announcements', body),
    joinRequests: () => request<{ items: Array<{ id: string; createdAt: string; requesterName: string; apartmentNumber: string; address: string }> }>('GET', '/company/join-requests').then((data) => data.items),
    decideJoin: (id: string, decision: 'approve' | 'reject') => request<unknown>('POST', `/company/join-requests/${id}/${decision}`),
    saveCompany: (body: Partial<Company>) => request<{ item: Company }>('PUT', '/company/company', body),
    team: () => request<{ items: Array<{ id: string; role: Role; displayName: string | null; username: string; viaMax: boolean; createdAt: string }> }>('GET', '/company/team').then((data) => data.items),
    invite: (role: 'dispatcher' | 'supervisor') => request<Invite>('POST', '/company/invites', { role }),
  },

  platform: {
    overview: () => request<{ total: Stats; companies: Array<Company & { buildingsCount: number; adminsCount: number; apartmentsCount: number; entrancesCount: number; stats: Stats }> }>('GET', '/platform/overview'),
    createCompany: (body: Partial<Company>) => request<{ item: Company }>('POST', '/platform/companies', body).then((data) => data.item),
    updateCompany: (id: string, body: Partial<Company>) => request<{ item: Company }>('PATCH', `/platform/companies/${id}`, body).then((data) => data.item),
    invite: (companyId: string, role: 'dispatcher' | 'supervisor') => request<Invite>('POST', `/platform/companies/${companyId}/invites`, { role }),
    duties: () => request<{ items: DutyBlock[]; law: DutyBlock[] }>('GET', '/platform/duties'),
    saveDuties: (items: DutyBlock[] | null) => request<{ items: DutyBlock[]; law: DutyBlock[] }>('PUT', '/platform/duties', { items }),
    deleteCompany: (companyId: string, withBuildings = false) => request<void>('DELETE', `/platform/companies/${companyId}${withBuildings ? '?withBuildings=true' : ''}`),
    admins: (companyId: string) => request<{ items: Array<{ id: string; name: string; viaMax: boolean; createdAt: string }> }>('GET', `/platform/companies/${companyId}/admins`).then((data) => data.items),
    removeAdmin: (id: string) => request<void>('DELETE', `/platform/admins/${id}`),
    transfer: (buildingId: string, companyId: string) => request<unknown>('POST', `/platform/buildings/${buildingId}/transfer`, { companyId }),
  },
};

export type DraftInput = { scope: 'building' | 'apartment'; category: Category; locationZone?: Exclude<Zone, 'apartment'>; entranceNumber?: number };

// Human texts for error codes of the API.
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Что-то пошло не так. Попробуйте ещё раз.';
  const texts: Record<string, string> = {
    network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    launch_data_required: 'Откройте приложение из чат-бота в MAX.',
    launch_data_expired: 'Ссылка устарела. Нажмите «Открыть приложение» в чате с ботом ещё раз.',
    wrong_building_code: 'Код дома не подошёл.',
    wrong_apartment_code: 'Код квартиры не подошёл.',
    wrong_contract_number: 'Номер договора не подошёл к этой квартире.',
    web_link_for_company_staff: 'Веб-пульт открывается сотрудникам УК. Откройте пульт нужной УК и войдите как её сотрудник.',
    too_many_attempts: 'Слишком много неверных кодов. Попробуйте через час или уточните код в УК.',
    apartment_not_found: 'Такой квартиры в доме нет. Проверьте номер.',
    residence_required: 'Сначала подтвердите свою квартиру.',
    incident_not_found: 'Заявка не найдена или недоступна.',
    building_not_found: 'Дом не найден или передан другой УК.',
    bot_username_missing: 'Не задано имя бота (MAX_BOT_USERNAME): ссылку для QR-кода не собрать.',
    building_exists: 'Такой дом уже подключён к сервису.',
    recipients_not_found: 'В этом доме пока нет подключённых жителей.',
    invalid_status_transition: 'Такой переход статуса невозможен.',
    incident_version_conflict: 'Заявку только что изменил другой сотрудник. Обновите карточку.',
    due_at_in_past: 'Срок не может быть в прошлом.',
    due_at_too_far: 'Срок не может быть дальше, чем через 3 года.',
    zone_not_for_category: 'Для этой проблемы такое место не подходит. Выберите другое.',
    invite_used: 'Это приглашение уже использовано.',
    invite_expired: 'Срок приглашения истёк. Попросите новое.',
    invite_not_found: 'Приглашение не найдено.',
    admin_of_another_company: 'Вы уже сотрудник другой УК.',
    platform_admin: 'Вы главный администратор платформы — приглашение не нужно.',
    insufficient_permissions: 'Недостаточно прав.',
    not_company_staff: 'Настройка доступна сотрудникам УК.',
    company_required: 'Выберите УК.',
    invalid_company: 'Проверьте поля: название и телефон обязательны.',
    invalid_building: 'Проверьте адрес и числа квартир и подъездов.',
    cannot_cancel: 'Эту заявку уже нельзя отменить.',
    feedback_closed: 'Ответ уже не принимается: заявка снова в работе или закрыта больше 14 дней назад.',
    invalid_plate: 'Введите госномер, например А123ВС96.',
    invalid_message: 'Проверьте номер квартиры и текст: от 2 до 1000 символов.',
    no_recipients: 'В этой квартире нет подключённых жителей. Укажите другую квартиру вашего дома.',
    invalid_car: 'Проверьте номер машины, имя и телефон.',
    invalid_phone: 'Телефон не похож на российский номер. Пример: +7 900 123-45-67.',
    car_already_yours: 'Эта машина уже есть в вашей квартире.',
    car_taken: 'Этот номер уже указан у другой квартиры. Если это ваша машина, обратитесь в УК.',
    cars_limit: 'Можно указать не больше 5 автомобилей. Удалите один, чтобы добавить новый.',
    invalid_building_code: 'Код дома — ровно 10 цифр.',
    invalid_apartment_codes: 'Код квартиры — от 6 символов, номер договора — от 4 цифр или букв.',
    cannot_remove_platform_admin: 'Главного администратора удалить нельзя.',
    invalid_chat_link: 'Ссылка не подходит. Скопируйте ссылку-приглашение чата из MAX: она начинается с https://max.ru/',
    poll_closed: 'Опрос уже завершён.',
    vote_final: 'В этом опросе голос нельзя изменить.',
    invalid_poll: 'Проверьте вопрос и варианты: от 2 до 15, без повторов.',
    poll_ends_at: 'Опрос должен длиться от 10 минут до 90 дней.',
    slot_taken: 'Это время уже заняли. Выберите другое.',
    too_many_bookings: 'Можно держать не больше двух записей одновременно.',
    invalid_booking: 'Укажите тему визита — хотя бы три буквы.',
    slots_in_past: 'Окна должны быть в будущем.',
    consent_required: 'Отметьте согласие на обработку персональных данных.',
    invalid_duties: 'Проверьте блоки: у каждого нужен заголовок и хотя бы одна обязанность.',
    invalid_quick_dial: 'Проверьте номера: только цифры, название не короче двух букв.',
    too_many_services: 'Служб уже 30 — уберите ненужные.',
    company_has_buildings: 'У этой УК есть дома. Сначала передайте их другой УК: карточка дома → «Передать другой УК».',
    alone_in_apartment: 'В вашей квартире больше никто не подключён — сообщение некому отправить.',
    too_many_messages: 'Можно отправить не больше 10 сообщений соседям в час. Попробуйте позже.',
  };
  if (error.code === 'wrong_building_code' || error.code === 'wrong_apartment_code' || error.code === 'wrong_contract_number') {
    const left = error.body.attemptsLeft;
    return `${texts[error.code]} ${typeof left === 'number' ? `Осталось попыток: ${left}.` : ''}`.trim();
  }
  return texts[error.code] ?? 'Не получилось. Попробуйте ещё раз.';
}
