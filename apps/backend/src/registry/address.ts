// Matching an address from the map (OpenStreetMap) with an address from the
// open housing registry. Both are reduced to a street key and a house key:
// "ул. Викулова, д. 48" and "улица Викулова 48" give "викулова" and "48",
// "пер. Шадринский, д. 14КОРПУС 2" and "Шадринский переулок 14к2" give
// "шадринский" and "14к2".

const streetTypes = [
  'улица', 'ул', 'проспект', 'пр-кт', 'пркт', 'просп', 'пр', 'переулок', 'пер', 'бульвар', 'б-р', 'бул',
  'шоссе', 'ш', 'площадь', 'пл', 'проезд', 'пр-д', 'набережная', 'наб', 'тракт', 'микрорайон', 'мкр', 'мкрн',
  'тупик', 'туп', 'аллея', 'ал', 'квартал', 'кв-л', 'линия', 'спуск', 'сквер', 'территория', 'тер',
];

function base(value: string) {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function streetKey(street: string): string {
  const words = base(street).replace(/\./g, ' ').split(/[\s,]+/).filter(Boolean);
  return words.filter((word) => !streetTypes.includes(word)).join(' ');
}

// "48", "1А", "14КОРПУС 2", "14 к2", "14к2", "14 корп. 2", "20 стр. 1" -> "48", "1а", "14к2", "14к2", "14к2", "14к2", "20с1"
export function houseKey(house: string): string {
  const value = base(house).replace(/^д\.?\s*/, '').replace(/^дом\s*/, '');
  const match = /^(\d+)\s*([а-я](?![а-я\d]))?\s*(?:,?\s*(?:корпус|корп\.?|к\.?)\s*(\d+[а-я]?))?\s*(?:,?\s*(?:строение|стр\.?|с\.?)\s*(\d+))?/.exec(value);
  if (!match) return value.replace(/\s+/g, '');
  return `${match[1]}${match[2] ?? ''}${match[3] ? `к${match[3]}` : ''}${match[4] ? `с${match[4]}` : ''}`;
}

export type RegistryAddress = { locality: string | null; street: string; house: string };

// Address of the registry: "г. Екатеринбург, ул. Викулова, д. 48",
// "пос. Мичуринский (г Екатеринбург), ул. Карасьевская, д. 16".
export function parseRegistryAddress(address: string): RegistryAddress | null {
  const parts = address.split(',').map((part) => part.trim());
  const houseIndex = parts.findIndex((part) => /^д\.?\s*\d/i.test(part));
  if (houseIndex < 1) return null;
  const houseParts = parts.slice(houseIndex).join(', ');
  const street = parts[houseIndex - 1]!;
  const localityPart = parts.slice(0, houseIndex - 1).reverse().find((part) => /^(г|пос|п|с|д|рп|пгт|дп)\.?\s/i.test(part));
  const locality = localityPart ? base(localityPart.replace(/^(г|пос|п|с|д|рп|пгт|дп)\.?\s+/i, '').replace(/\s*\(.*\)$/, '')) : null;
  return { locality, street, house: houseParts };
}

// The way the registry address is shown to people: "ул. Викулова, д. 48" ->
// street "ул. Викулова", house "48".
