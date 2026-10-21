// Car plates, one way for the bot, the app and the web desk.
// Russian plates use only letters that look the same in Latin; a plate typed
// on a Latin keyboard is turned into the Cyrillic one.
const latinToCyrillic: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const cyrillicToLatin: Record<string, string> = Object.fromEntries(Object.entries(latinToCyrillic).map(([latin, cyrillic]) => [cyrillic, latin]));

export function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '').replace(/[ABEKMHOPCTYX]/g, (letter) => latinToCyrillic[letter]!);
}

// "А123ВС" finds "А123ВС96" and "А123ВС196": the region may be left out.
export function plateBase(value: string) {
  return /^([A-ZА-Я]\d{3}[A-ZА-Я]{2})(\d{2,3})$/.exec(value)?.[1] ?? value;
}

// Plates saved before the letters were unified may be in Latin: the search
// looks for both spellings.
export function plateWhere(typed: string) {
  const plate = normalizePlate(typed);
  const base = plateBase(plate);
  const toLatin = (value: string) => value.replace(/[АВЕКМНОРСТУХ]/g, (letter) => cyrillicToLatin[letter]!);
  return plate === base
    ? { OR: [...new Set([base, toLatin(base)])].map((value) => ({ licensePlate: { startsWith: value } })) }
    : { OR: [...new Set([plate, toLatin(plate)])].map((value) => ({ licensePlate: value })) };
}
