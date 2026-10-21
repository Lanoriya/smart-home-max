import { useRef, useState } from 'react';
import { Button, Input } from '@maxhub/max-ui';
import { api, ApiError, type AddressSuggestion, type CitySuggestion } from '../api';
import { Icon } from './icons';
import { useSearch } from '../search';

// Address above a map: a city (with its region — towns share names), then a
// street and house in it. Suggestions open as a list right under the field
// and push the map down instead of covering it. "Найти" makes one precise
// search when the suggestions do not have the house.



export function cityLabel(city: CitySuggestion) {
  return city.region ? `${city.name}, ${city.region}` : city.name;
}

export function AddressSearch({ onAddress, onCity, hint = 'Или нажмите на дом на карте', cityOnly = false }: {
  onAddress?: (address: AddressSuggestion) => void;
  onCity?: (city: CitySuggestion) => void;
  hint?: string;
  // Only the city: for screens that take a list of addresses in it.
  cityOnly?: boolean;
}) {
  // The city is chosen anew each time: a city remembered from another visit
  // was silently used for a search in the wrong town.
  const [city, setCity] = useState<CitySuggestion | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [editingCity, setEditingCity] = useState(!city);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [resolving, setResolving] = useState(false);
  const addressInput = useRef<HTMLInputElement>(null);
  const cities = useSearch('cities', editingCity ? cityQuery : '', api.geoCities);
  const addresses = useSearch(`addresses|${city?.name}|${city?.region}`, chosen ? '' : query, (value) => api.geoAddresses(value, city));


  const chooseCity = (next: CitySuggestion) => {
    setCity(next);
    setCityQuery('');
    setEditingCity(false);
    cities.setItems([]);
    onCity?.(next);
    if (!cityOnly) setTimeout(() => addressInput.current?.focus(), 50);
  };

  const choose = (item: AddressSuggestion) => {
    if (!item.house) {
      // A street: the person adds the number next.
      setQuery(`${item.street} `);
      onAddress?.(item);
      addresses.setItems([]);
      setTimeout(() => addressInput.current?.focus(), 50);
      return;
    }
    setQuery(`${item.street}, ${item.house}`);
    setChosen(true);
    addresses.setItems([]);
    onAddress?.(item);
  };

  const find = async () => {
    if (!city || query.trim().length < 2) return;
    setResolving(true);
    setNotFound(false);
    try {
      choose(await api.geoResolve(query, city));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setNotFound(true);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="address-search">
      <div className="address-step">
        <span className="address-label">Город</span>
        {editingCity ? (
          <>
            <Input maxLength={100} value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="Например, Казань" />
            {cities.items.length ? (
              <ul className="suggestions" role="listbox" aria-label="Города">
                {cities.items.map((item) => (
                  <li key={`${item.name}-${item.region}-${item.latitude}`}>
                    <button type="button" onClick={() => chooseCity(item)}>
                      <span>{item.name}</span>
                      {item.region ? <span className="suggestion-sub">{item.region}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : cities.loading ? <p className="suggestion-empty">Ищем…</p> : null}
            {city ? <button type="button" className="link-button" onClick={() => setEditingCity(false)}>Оставить {city.name}</button> : null}
          </>
        ) : (
          <button type="button" className="city-chip" onClick={() => setEditingCity(true)}>
            <span className="city-chip-name">{city ? cityLabel(city) : ''}</span>
            <span className="city-chip-change">Изменить</span>
          </button>
        )}
      </div>
      {!editingCity && !cityOnly ? (
        <div className="address-step">
          <span className="address-label">Улица и дом</span>
          <form className="address-line" onSubmit={(event) => { event.preventDefault(); void find(); }}>
            <Input maxLength={200} ref={addressInput} value={query} onChange={(event) => { setQuery(event.target.value); setChosen(false); setNotFound(false); }} placeholder="Например, Ленина 12 к1" withClearButton />
            <Button type="submit" size="medium" variant="secondary" loading={resolving} disabled={query.trim().length < 2}>Найти</Button>
          </form>
          {addresses.items.length ? (
            <ul className="suggestions" role="listbox" aria-label="Адреса">
              {addresses.items.map((item) => (
                <li key={`${item.street}-${item.house}-${item.latitude}`}>
                  <button type="button" onClick={() => choose(item)}>
                    <span>{item.house ? `${item.street}, ${item.house}` : item.street}</span>
                    {!item.house ? <span className="suggestion-sub">улица, добавьте номер дома</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {notFound ? <p className="suggestion-empty">Такой адрес не нашёлся. Проверьте номер или нажмите на дом на карте.</p> : null}
        </div>
      ) : null}
      {hint ? <p className="address-hint"><Icon name="pin" size={16} />{hint}</p> : null}
    </div>
  );
}
