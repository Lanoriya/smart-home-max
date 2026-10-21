// Apartment numbers, one way for the bot, the app and the web desk: digits
// and at most one letter («12А»). Spaces and dashes are dropped («12 а»,
// «12-а»), the letter is capital, and a Latin letter that looks like a Russian
// one is read as Russian.
const latinToCyrillic: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const pattern = /^\d{1,10}[А-ЯЁA-Z]?$/;

export function normalizeApartmentNumber(value: string): string | null {
  const compact = value.trim().replace(/[\s-]+/g, '').toUpperCase().replace(/[ABEKMHOPCTYX]/g, (letter) => latinToCyrillic[letter]!);
  return pattern.test(compact) ? compact : null;
}

// Stored numbers may still be written in small or Latin letters.
export function apartmentNumberWhere(number: string) {
  const variants = new Set([number, number.replace(/[АВЕКМНОРСТУХ]$/, (letter) => Object.entries(latinToCyrillic).find(([, cyrillic]) => cyrillic === letter)![0])]);
  return { OR: [...variants].map((variant) => ({ number: { equals: variant, mode: 'insensitive' as const } })) };
}
