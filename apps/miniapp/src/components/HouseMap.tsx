import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { AttributionControl, MapContainer, Marker, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { bridge } from '../bridge';

// The map of houses. Each house is a small plate with the number of open
// common issues (a house sign when nothing is open): green — nothing open,
// amber — a few, red — many. Offices of
// management companies are drawn as round marks. In "pick" mode a tap puts a
// point (a new house or office) — another tap puts the pin elsewhere.

export type MapHouse = { id: string; latitude: number; longitude: number; openIssues: number; label: string; selected?: boolean; muted?: boolean; companyId?: string; highlighted?: boolean };

// Each management company gets its own colour for the frame of its houses, so
// the houses of one company are seen together on the map.
const companyColors = ['#0077ff', '#8a4dff', '#ff7a00', '#00a3a3', '#e5398b', '#5b8c00', '#c2410c', '#2563eb', '#a21caf', '#0f766e'];
export function companyColor(companyId: string) {
  let hash = 0;
  for (const char of companyId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return companyColors[hash % companyColors.length]!;
}
export type MapOffice = { id: string; latitude: number; longitude: number; name: string; selected?: boolean };
export type Point = { latitude: number; longitude: number };

// Yekaterinburg: where the demo houses are.
const fallbackCenter: [number, number] = [56.8389, 60.6057];

const houseGlyph = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>';

function houseIcon(house: MapHouse) {
  const tone = house.openIssues === 0 ? 'ok' : house.openIssues < 3 ? 'some' : 'many';
  return L.divIcon({
    className: '',
    html: `<div class="map-house map-house-${tone}${house.selected ? ' map-house-selected' : ''}${house.muted ? ' map-house-muted' : ''}${house.highlighted ? ' map-house-highlighted' : ''}"${house.companyId ? ` style="--company:${companyColor(house.companyId)}"` : ''} aria-label="${escapeHtml(house.label)}"><span>${house.openIssues || houseGlyph}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function officeIcon(office: MapOffice) {
  return L.divIcon({
    className: '',
    html: `<div class="map-office-tag${office.selected ? ' map-office-selected' : ''}" aria-label="${escapeHtml(office.name)}"><b>УК</b></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
  });
}

// A house marked but not connected yet: a dashed ring, the last one larger.
function pendingIcon(latest: boolean) {
  return L.divIcon({ className: '', html: `<div class="map-pending${latest ? ' map-pending-latest' : ''}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
}

const pinIcon = L.divIcon({ className: '', html: '<div class="map-pin"></div>', iconSize: [28, 40], iconAnchor: [14, 38] });

const officePinIcon = L.divIcon({ className: '', html: '<div class="map-office-tag"><b>УК</b></div>', iconSize: [34, 42], iconAnchor: [17, 42] });
const meIcon = L.divIcon({ className: '', html: '<div class="map-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

// "Найти меня": the map only moves to the person, a blue dot shows where they
// are. A Leaflet control in the corner of the zoom buttons, stacked above them.
function LocateMe() {
  const map = useMap();
  const [me, setMe] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [box] = useState(() => L.DomUtil.create('div', 'leaflet-bar map-locate-control'));
  useEffect(() => {
    const control = new L.Control({ position: 'bottomright' });
    control.onAdd = () => box;
    control.addTo(map);
    // A tap on the button is not a tap on the map: it does not put a pin.
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return () => { control.remove(); };
  }, [map, box]);
  const locate = () => {
    if (!navigator.geolocation) { setFailed(true); return; }
    setBusy(true);
    setFailed(false);
    navigator.geolocation.getCurrentPosition((position) => {
      const point: [number, number] = [position.coords.latitude, position.coords.longitude];
      setMe(point);
      map.setView(point, Math.max(map.getZoom(), 16));
      setBusy(false);
    }, () => { setBusy(false); setFailed(true); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };
  return (
    <>
      {createPortal(
        <button type="button" className={`map-locate${busy ? ' map-locate-busy' : ''}`} onClick={locate} disabled={busy} aria-label="Найти меня" title="Найти меня">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>,
        box,
      )}
      {failed ? <div className="map-locate-note">Место не определено: разрешите доступ к геопозиции</div> : null}
      {me ? <Marker position={me} icon={meIcon} interactive={false} keyboard={false} /> : null}
    </>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function FitBounds({ points, focus, focusZoom, view }: { points: Array<[number, number]>; focus: [number, number] | null; focusZoom: number; view: { latitude: number; longitude: number; zoom: number } | null }) {
  const map = useMap();
  // The houses are fitted into the map once, when they first arrive. After
  // that the map stays where the person moved it: a house added to a list or
  // a new marker does not throw the view back to the whole country.
  const fitted = useRef(false);
  useEffect(() => {
    if (view && !focus) { map.setView([view.latitude, view.longitude], view.zoom); fitted.current = true; }
  }, [view?.latitude, view?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focus) { map.setView(focus, Math.max(map.getZoom(), focusZoom)); fitted.current = true; return; }
    if (view || fitted.current || !points.length) return;
    fitted.current = true;
    if (points.length === 1) map.setView(points[0]!, 16);
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length > 0, focus?.[0], focus?.[1]]);
  return null;
}

// Leaflet measures its box once; after the map is expanded it has to re-measure.
function Resize({ expanded }: { expanded: string }) {
  const map = useMap();
  useEffect(() => { const timer = setTimeout(() => map.invalidateSize(), 50); return () => clearTimeout(timer); }, [expanded, map]);
  return null;
}

function PickPoint({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({ click: (event) => onPick({ latitude: round(event.latlng.lat), longitude: round(event.latlng.lng) }) });
  return null;
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

export function HouseMap(props: {
  houses: MapHouse[];
  offices?: MapOffice[];
  onHouse?: (id: string) => void;
  onOffice?: (id: string) => void;
  onPick?: (point: Point) => void;
  pin?: Point | null;
  // The picked point is the office of a company: drawn like offices, not like a house.
  pinKind?: 'office';
  // A button that moves the map to where the person is (on by default).
  locate?: boolean;
  // Houses marked in a list before they are connected.
  pending?: Array<Point & { latest?: boolean }>;
  // What the numbers and colours mean, under the map.
  legend?: boolean;
  focus?: Point | null;
  // How close the map comes to a focused point; picking a house wants 18.
  focusZoom?: number;
  // A city chosen in the address field.
  view?: { latitude: number; longitude: number; zoom: number } | null;
  height?: number | string;
  expandable?: boolean;
  // Fill the screen below the page header; the map is the screen.
  fill?: boolean;
  // Floats over the top of the map, for example the address field.
  overlay?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const points = useMemo(() => [
    ...props.houses.map((house) => [house.latitude, house.longitude] as [number, number]),
    ...(props.offices ?? []).map((office) => [office.latitude, office.longitude] as [number, number]),
  ], [props.houses, props.offices]);
  const focus = props.focus ? [props.focus.latitude, props.focus.longitude] as [number, number] : null;

  return (
    <>
    {props.legend ? <MapLegend pending={Boolean(props.pending)} offices={Boolean(props.offices?.length)} /> : null}
    <div className={`map-frame${expanded ? ' map-frame-expanded' : ''}${props.fill && !expanded ? ' map-frame-fill' : ''}`} style={expanded || props.fill ? undefined : { height: props.height ?? 360 }}>
      {props.overlay ? <div className="map-overlay">{props.overlay}</div> : null}
      {props.expandable ? (
        <button type="button" className="map-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Готово' : 'Развернуть'}</button>
      ) : null}
      <MapContainer center={points[0] ?? fallbackCenter} zoom={14} zoomControl={false} attributionControl={false} style={{ height: '100%', width: '100%' }}>
        <ZoomControl position="bottomright" />
        <Resize expanded={`${expanded}-${props.fill}-${props.height}`} />
        {/* Only the attribution the OpenStreetMap licence requires, without the
            library banner. In its own corner, so the zoom buttons never push it up. */}
        <AttributionControl prefix={false} position="bottomleft" />
        <ExternalLinks />
        <TileLayer
          url="/tiles/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <FitBounds points={points} focus={focus} focusZoom={props.focusZoom ?? 16} view={props.view ?? null} />
        {props.onPick ? <PickPoint onPick={props.onPick} /> : null}
        {props.locate === false ? null : <LocateMe />}
        <OfficeMarkers offices={props.offices ?? []} {...(props.onOffice ? { onOffice: props.onOffice } : {})} />
        <HouseMarkers houses={props.houses} {...(props.onHouse ? { onHouse: props.onHouse } : {})} />
        {props.pin ? (
          // The pin only shows the chosen point: it is not dragged and does
          // not catch taps, so a tap next to it simply puts it there.
          <Marker position={[props.pin.latitude, props.pin.longitude]} icon={props.pinKind === 'office' ? officePinIcon : pinIcon} zIndexOffset={2000} interactive={false} keyboard={false} />
        ) : null}
        {(props.pending ?? []).map((point) => (
          <Marker key={`${point.latitude},${point.longitude}`} position={[point.latitude, point.longitude]} icon={pendingIcon(Boolean(point.latest))} interactive={false} keyboard={false} />
        ))}
      </MapContainer>
    </div>
    </>
  );
}

// What the marks on the map mean. The number on a house is the count of its
// open common problems.
export function MapLegend({ pending = false, offices = false }: { pending?: boolean; offices?: boolean }) {
  return (
    <div className="legend">
      <span><i className="dot dot-ok" />нет открытых проблем</span>
      <span><i className="dot dot-some" />цифра 1–2 — открытые проблемы</span>
      <span><i className="dot dot-many" />3 и больше</span>
      <span><i className="dot dot-frame" />рамка — цвет УК</span>
      <span><i className="dot dot-cluster" />кружок с числом — несколько домов, нажмите, чтобы приблизить</span>
      {offices ? <span><i className="dot dot-office" />офис УК</span> : null}
      {pending ? <span><i className="dot dot-pending" />отмечен, ещё не подключён</span> : null}
    </div>
  );
}

// Houses close to each other on the screen are drawn as one circle with their
// count, coloured by the most troubled house among them; a tap zooms in to
// them. Close enough, every house has its own plate again. A chosen or
// highlighted house is never hidden in a group.
const clusterCell = 54;

function clusterIcon(count: number, openIssues: number, worst: number) {
  const tone = worst === 0 ? 'ok' : worst < 3 ? 'some' : 'many';
  const size = count < 10 ? 38 : count < 50 ? 44 : 50;
  return L.divIcon({
    className: '',
    html: `<div class="map-cluster map-cluster-${tone}" style="width:${size}px;height:${size}px"><b>${count}</b>${openIssues ? `<small>${openIssues} пробл.</small>` : '<small>домов</small>'}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function HouseMarkers({ houses, onHouse }: { houses: MapHouse[]; onHouse?: (id: string) => void }) {
  const map = useMap();
  const [view, setView] = useState(0);
  useMapEvents({ zoomend: () => setView((value) => value + 1), moveend: () => setView((value) => value + 1) });
  // The view may be set before these events are listened to: count once more
  // right after the map appears.
  useEffect(() => { const timer = setTimeout(() => setView((value) => value + 1), 60); return () => clearTimeout(timer); }, [houses.length]);
  const groups = useMemo(() => {
    const zoom = map.getZoom();
    if (zoom >= 15) return houses.map((house) => [house]);
    const cells = new Map<string, MapHouse[]>();
    const single: MapHouse[][] = [];
    for (const house of houses) {
      if (house.selected || house.highlighted) { single.push([house]); continue; }
      const point = map.project([house.latitude, house.longitude], zoom);
      const key = `${Math.floor(point.x / clusterCell)}:${Math.floor(point.y / clusterCell)}`;
      cells.set(key, [...(cells.get(key) ?? []), house]);
    }
    return [...cells.values(), ...single];
  }, [houses, view, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {groups.map((group) => {
        if (group.length === 1) {
          const house = group[0]!;
          return <Marker key={house.id} position={[house.latitude, house.longitude]} icon={houseIcon(house)} eventHandlers={{ click: () => onHouse?.(house.id) }} />;
        }
        const latitude = group.reduce((sum, house) => sum + house.latitude, 0) / group.length;
        const longitude = group.reduce((sum, house) => sum + house.longitude, 0) / group.length;
        const open = group.reduce((sum, house) => sum + house.openIssues, 0);
        const worst = Math.max(...group.map((house) => house.openIssues));
        return (
          <Marker key={`group-${group.map((house) => house.id).join(',')}`} position={[latitude, longitude]} icon={clusterIcon(group.length, open, worst)}
            eventHandlers={{ click: () => map.fitBounds(L.latLngBounds(group.map((house) => [house.latitude, house.longitude] as [number, number])), { padding: [48, 48], maxZoom: 17 }) }} />
        );
      })}
    </>
  );
}

// Offices are drawn from the zoom of a region down: over the whole country
// they would cover the groups of houses. A chosen office is always shown.
function OfficeMarkers({ offices, onOffice }: { offices: MapOffice[]; onOffice?: (id: string) => void }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()), moveend: () => setZoom(map.getZoom()), viewreset: () => setZoom(map.getZoom()) });
  useEffect(() => { const timer = setTimeout(() => setZoom(map.getZoom()), 300); return () => clearTimeout(timer); }, [map]);
  return (
    <>
      {offices.filter((office) => zoom >= 9 || office.selected).map((office) => (
        <Marker key={`office-${office.id}`} position={[office.latitude, office.longitude]} icon={officeIcon(office)} zIndexOffset={2000} eventHandlers={{ click: () => onOffice?.(office.id) }} />
      ))}
    </>
  );
}

// Links of the map (the OpenStreetMap attribution) open in the browser, not
// inside the mini-app, where other sites refuse to load.
function ExternalLinks() {
  const map = useMap();
  useEffect(() => {
    const box = map.getContainer();
    const open = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest('a[href^="http"]');
      if (!link) return;
      event.preventDefault();
      bridge.openLink((link as HTMLAnchorElement).href);
    };
    box.addEventListener('click', open);
    return () => box.removeEventListener('click', open);
  }, [map]);
  return null;
}
