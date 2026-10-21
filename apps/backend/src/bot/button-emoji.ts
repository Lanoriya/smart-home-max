import type { CallbackButton } from './messenger.js';

// MAX does not let a bot colour its buttons, so each button gets a small sign
// of what it does: houses, search, back, cancel. The sign is chosen by the
// payload, so every screen of the bot gets the same signs without listing
// them by hand. A button whose text already starts with a sign keeps it.

const exact: Record<string, string> = {
  'menu:main': '🏠',
  'flow:cancel': '✖️',
  'incident:create': '📝',
  'incident:new': '📝',
  'incident:submit': '✅',
  'incident:new-photo': '📷',
  'incidents:list': '📋',
  'incidents:general': '🏢',
  'announcements:list': '📢',
  'uk:contacts': '📞',
  'emergency:services': '🚨',
  'neighbors:menu': '👥',
  'car:search': '🚗',
  'resident:message': '✉️',
  'profile:view': '👤',
  'profile:residents': '👪',
  'profile:visibility': '👁️',
  'profile:phone-consent:yes': '✅',
  'profile:phone-consent:no': '🙈',
  'contact:share': '📱',
  'contact:remove': '🗑️',
  'hh:cars': '🚗',
  'hh:car-add': '➕',
  'hh:people': '👪',
  'hh:person-add': '➕',
  'bot:info': 'ℹ️',
  'chat:open': '💬',
  'apartment:change': '🔁',
  'apartment:change:confirm': '🔁',
  'apartment:leave': '🚪',
  'apartment:leave:confirm': '🚪',
  'join:cancel': '✖️',
  'address:search': '🔎',
  'address:browse': '🛣️',
  'city:change': '🏙️',
  'map': '🗺️',
  'scope:building': '🏢',
  'scope:apartment': '🚪',
  'zone:entrance': '🚪',
  'zone:elevator': '🛗',
  'zone:yard': '🌳',
  'zone:common': '📍',
};

const prefixes: Array<[string, string]> = [
  ['city:choose:', '📍'],
  ['street:choose:', '🛣️'],
  ['building:choose:', '🏠'],
  ['incident:view:', '📄'],
  ['join:approve:', '✅'],
  ['join:reject:', '✖️'],
  ['resident:reply:', '✉️'],
  ['entrance:', '🚪'],
];

// A letter or a digit at the start means there is no sign yet.
const startsWithText = /^[\p{L}\p{N}«"(]/u;

export function signFor(button: Pick<CallbackButton, 'payload' | 'text'> & { openApp?: boolean }) {
  if (!startsWithText.test(button.text)) return null;
  if (button.text === 'Отмена') return '✖️';
  if (button.openApp && button.payload !== 'map') return '📱';
  return exact[button.payload] ?? prefixes.find(([prefix]) => button.payload.startsWith(prefix))?.[1] ?? null;
}

export function withSigns(buttons: CallbackButton[][]): CallbackButton[][] {
  return buttons.map((row) => row.map((button) => {
    const sign = signFor(button);
    return sign ? { ...button, text: `${sign} ${button.text}` } : button;
  }));
}
