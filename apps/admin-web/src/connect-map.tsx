import { useEffect, useMemo } from 'react';
import { AttributionControl, CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { MapData, Point } from './platform';

type View = { latitude: number; longitude: number; zoom: number };

// Houses in the service as small dots (the chosen company's in blue), the
// houses of the list as dashed rings. A click recognises the house there.
export default function ConnectMap({ houses, companyId, pending, view, onPick }: { houses: MapData['buildings']; companyId: string | null; pending: Point[]; view: View | null; onPick?: ((point: Point) => void) | undefined }) {
  const placed = useMemo(() => houses.filter((house) => house.latitude !== null && house.longitude !== null), [houses]);
  const own = placed.filter((house) => house.companyId === companyId);
  const start: [number, number] = own[0] ? [own[0].latitude!, own[0].longitude!] : [56.8389, 60.6057];
  return <div className="connect-map">
    <MapContainer center={start} zoom={own.length ? 13 : 5} attributionControl={false} style={{ height: '100%', width: '100%' }}>
      <AttributionControl prefix={false} />
      <TileLayer url="/tiles/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' maxZoom={19} />
      {onPick ? <Pick onPick={onPick} /> : null}
      <FlyTo view={view} />
      {placed.map((house) => <CircleMarker key={house.id} center={[house.latitude!, house.longitude!]} radius={6} pathOptions={house.companyId === companyId ? { color: '#ffffff', weight: 2, fillColor: '#1f4e8c', fillOpacity: 1 } : { color: '#ffffff', weight: 1, fillColor: '#8a8f98', fillOpacity: 0.85 }} interactive><Tooltip>{house.address}</Tooltip></CircleMarker>)}
      {pending.map((point) => <CircleMarker key={`${point.latitude},${point.longitude}`} center={[point.latitude, point.longitude]} radius={10} pathOptions={{ color: '#d9480f', weight: 2, dashArray: '4 3', fillColor: '#d9480f', fillOpacity: 0.15 }} interactive={false} />)}
    </MapContainer>
    {onPick ? <p className="form-hint map-legend"><i className="legend-dot own" /> дома этой УК <i className="legend-dot other" /> других УК <i className="legend-dot pending" /> отмечены для подключения</p> : null}
  </div>;
}

function Pick({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({ click: (event) => onPick({ latitude: Math.round(event.latlng.lat * 1e6) / 1e6, longitude: Math.round(event.latlng.lng * 1e6) / 1e6 }) });
  return null;
}

function FlyTo({ view }: { view: View | null }) {
  const map = useMap();
  useEffect(() => { if (view) map.setView([view.latitude, view.longitude], view.zoom); }, [view?.latitude, view?.longitude, view?.zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
