import { CellSimple } from '@maxhub/max-ui';
import type { HouseLookup, LookupSource } from '../api';
import { Section } from './ui';

// What was recognised about a house by a tap on the map, with the source of
// every value. Values that were not found are listed too: the person fills
// them in, nothing is invented.

const sourceLabels: Record<LookupSource, string> = {
  map: 'карта OpenStreetMap',
  registry: 'реестр ФРТ (Реформа ЖКХ)',
  service: 'Домовед',
};

function Source({ source }: { source: LookupSource | undefined }) {
  return source ? <span className={`source source-${source}`}>{sourceLabels[source]}</span> : <span className="source source-missing">не найдено — заполните</span>;
}

export function HouseFacts({ lookup }: { lookup: HouseLookup }) {
  const { details, filled } = lookup;
  if (!lookup.address) {
    return (
      <div className="insight">
        Здесь нет адреса. Нажмите точнее на здание или введите адрес.
      </div>
    );
  }
  return (
    <Section header="Найдено автоматически">
      <CellSimple title={lookup.address.display} subtitle={<Source source={filled.street} />} />
      <CellSimple title={details.floors ? `${details.floors} этажей` : 'Этажность'} subtitle={<Source source={filled.floors} />} />
      <CellSimple title={details.builtYear ? `Построен в ${details.builtYear}` : 'Год постройки'} subtitle={<Source source={filled.builtYear} />} />
      <CellSimple title={details.apartments ? `${details.apartments} квартир` : 'Число квартир'} subtitle={<Source source={filled.apartments} />} />
      {details.totalArea ? <CellSimple title={`Площадь ${Math.round(details.totalArea).toLocaleString('ru-RU')} м²`} subtitle={<Source source={filled.totalArea} />} /> : null}
      <CellSimple title="Подъезды" subtitle={<Source source={undefined} />} />
    </Section>
  );
}
