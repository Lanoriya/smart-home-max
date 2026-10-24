// Contract numbers are compared the way people type them from a receipt:
// without spaces and dashes, in any case, and with Latin letters that look
// like Cyrillic ones taken as the same letter ("ДУ-6/2024" = "ду 6/2024").
const lookalikes: Record<string, string> = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };

export function contractKey(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase().replace(/Ё/g, 'Е').replace(/[ABCEHKMOPTXY]/g, (letter) => lookalikes[letter]!);
}
