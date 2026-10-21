// Russian numbers in any common spelling: +7 900 123-45-67, 8 (3452) 12-34-56,
// 9001234567. Mobile and landline numbers start with 3, 4, 8 or 9 after the
// country code.
export function normalizeRussianPhone(value: string): string | null {
  if (!/^[\d\s()+.-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))
    ? digits.slice(1)
    : digits.length === 10 ? digits : '';
  return /^[3489]\d{9}$/.test(national) ? `+7${national}` : null;
}

export function formatRussianPhone(normalized: string): string {
  const national = normalized.slice(2);
  return `+7 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8)}`;
}

// A stored number as people read it; anything else as it was typed.
export function displayPhone(phone: string) {
  return /^\+7\d{10}$/.test(phone) ? formatRussianPhone(phone) : phone;
}
