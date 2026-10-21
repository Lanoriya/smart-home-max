import { useEffect, useState } from 'react';
import { Input, Spinner } from '@maxhub/max-ui';
import { api, type HouseLookup } from '../api';
import type { Point } from './HouseMap';
import { HouseFacts } from './HouseFacts';
import { Field } from './ui';

// Fields of a new house. A tap on the map recognises the house and fills in
// what could be found; the person corrects it or adds the rest.

export type HouseValues = {
  street: string;
  house: string;
  apartments: string;
  entrances: string;
  fiasGuid: string | null;
  floors: number | null;
  builtYear: number | null;
  city: string | null;
};

export const emptyHouse: HouseValues = { street: '', house: '', apartments: '', entrances: '', fiasGuid: null, floors: null, builtYear: null, city: null };

export function houseReady(values: HouseValues) {
  return values.street.trim().length >= 2 && values.house.trim().length > 0 && Number(values.apartments) >= 1 && Number(values.entrances) >= 1;
}

export function useHouseLookup(point: Point | null) {
  const [lookup, setLookup] = useState<HouseLookup | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!point) { setLookup(null); return; }
    let cancelled = false;
    setLoading(true);
    api.lookup(point)
      .then((result) => { if (!cancelled) setLookup(result); })
      .catch(() => { if (!cancelled) setLookup(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [point?.latitude, point?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps
  return { lookup, loading };
}

// Values found for the house, applied over what the person has not typed yet.
export function applyLookup(values: HouseValues, lookup: HouseLookup | null, touched: Set<keyof HouseValues>): HouseValues {
  if (!lookup?.address) return values;
  const next = { ...values };
  if (!touched.has('street')) next.street = lookup.address.street;
  if (!touched.has('house')) next.house = lookup.address.house;
  if (!touched.has('apartments') && lookup.details.apartments) next.apartments = String(lookup.details.apartments);
  next.fiasGuid = lookup.details.fiasGuid;
  next.floors = lookup.details.floors;
  next.builtYear = lookup.details.builtYear;
  next.city = lookup.address.locality;
  return next;
}

export function HouseFields({ values, onChange, lookup, loading }: {
  values: HouseValues;
  onChange: (values: HouseValues, field: keyof HouseValues) => void;
  lookup: HouseLookup | null;
  loading: boolean;
}) {
  const set = (field: keyof HouseValues, digits = false) => (event: { target: { value: string } }) =>
    onChange({ ...values, [field]: digits ? event.target.value.replace(/\D/g, '') : event.target.value }, field);
  return (
    <>
      {loading ? <div className="lookup-loading"><Spinner size={20} /> Определяем дом по карте и реестру…</div> : null}
      {lookup && !loading ? <HouseFacts lookup={lookup} /> : null}
      {lookup?.existing ? (
        <div className="form-error" role="alert">
          Этот дом уже в сервисе: {lookup.existing.address}, его обслуживает «{lookup.existing.company.name}».
        </div>
      ) : null}
      <div className="form">
        <Field label="Улица"><Input maxLength={200} value={values.street} onChange={set('street')} placeholder="ул. Ленина" /></Field>
        <Field label="Дом"><Input maxLength={60} value={values.house} onChange={set('house')} placeholder="12, корп. 1" /></Field>
        <div className="form-row">
          <Field label="Квартир"><Input inputMode="numeric" value={values.apartments} onChange={set('apartments', true)} /></Field>
          <Field label="Подъездов"><Input inputMode="numeric" value={values.entrances} onChange={set('entrances', true)} /></Field>
        </div>
      </div>
    </>
  );
}

export function houseBody(values: HouseValues, point: Point) {
  return {
    street: values.street.trim(),
    house: values.house.trim(),
    apartmentsCount: Number(values.apartments),
    entrancesCount: Number(values.entrances),
    ...point,
    fiasGuid: values.fiasGuid,
    floors: values.floors,
    builtYear: values.builtYear,
    city: values.city,
  };
}
