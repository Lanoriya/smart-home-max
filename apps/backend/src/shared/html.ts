// Messages to MAX are sent with HTML formatting. Plain strings are always
// escaped, so text typed by residents or dispatchers can never break the
// markup. Formatting is possible only through the `html` template, which
// escapes every interpolated value that is not itself an Html fragment.
export class Html {
  constructor(readonly value: string) {}
  toString() { return this.value; }
}

type Part = Html | string | number | null | undefined | false;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(part: Part | Part[]): string {
  if (Array.isArray(part)) return part.map(render).join('');
  if (part === null || part === undefined || part === false) return '';
  return part instanceof Html ? part.value : escapeHtml(String(part));
}

export function html(strings: TemplateStringsArray, ...values: Array<Part | Part[]>): Html {
  return new Html(strings.reduce((result, chunk, index) => result + chunk + (index < values.length ? render(values[index]!) : ''), ''));
}

// Joins non-empty parts; an empty string or null drops the line entirely.
export function lines(parts: Part[], separator = '\n'): Html {
  return new Html(parts.filter((part) => part !== null && part !== undefined && part !== false && part !== '').map(render).join(separator));
}

// A message made of blocks separated by an empty line; each block is a list
// of lines. Empty blocks are skipped, so optional sections need no extra code.
export function blocks(...groups: Part[][]): Html {
  return lines(groups.map((group) => lines(group)).filter((group) => group.value !== ''), '\n\n');
}

export function bold(value: Part): Html {
  return html`<b>${value}</b>`;
}

export function toHtml(text: string | Html): string {
  return text instanceof Html ? text.value : escapeHtml(text);
}

// Plain text of a fragment, used when a message must be shortened: cutting
// HTML in the middle of a tag would make MAX reject the whole message.
export function toPlainText(text: string | Html): string {
  if (!(text instanceof Html)) return text;
  return text.value.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
