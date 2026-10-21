export function composeAddress(street: string, house: string): string {
  return house ? `${street}, ${house}` : street;
}

// Natural order for streets and houses: "д. 2" before "д. 10", "12" before "12а".
export function compareBuildings(left: { street: string; house: string }, right: { street: string; house: string }): number {
  return left.street.localeCompare(right.street, 'ru', { numeric: true, sensitivity: 'base' })
    || left.house.localeCompare(right.house, 'ru', { numeric: true, sensitivity: 'base' });
}

// Address words that residents type in many ways and that carry no meaning
// for the search: "ул. Садовая, д. 7" and "садовая 7" are the same building.
const addressNoise = new Set(['ул', 'улица', 'пр', 'прт', 'просп', 'проспект', 'пер', 'переулок', 'д', 'дом', 'корп', 'корпус', 'к', 'стр', 'строение', 'бр', 'бульвар', 'ш', 'шоссе', 'пл', 'площадь', 'наб', 'набережная', 'г', 'город', 'мкр', 'микрорайон']);

export function addressTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .split(/[^\p{L}\d]+/u)
    .filter((token) => token && !addressNoise.has(token));
}

// Every word of the query must be found in the address: words by their
// beginning ("сад" finds "Садовая"), numbers exactly ("7" does not find "70").
export function addressMatches(address: string, query: string): boolean {
  const target = addressTokens(address);
  const wanted = addressTokens(query);
  return wanted.length > 0 && wanted.every((word) => target.some((token) => (/^\d+$/.test(word) ? token === word : token.startsWith(word))));
}
