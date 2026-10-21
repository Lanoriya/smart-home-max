import { env } from '../config/env.js';
import { signLinkToken } from '../miniapp/link-token.js';
import type { CallbackButton } from './messenger.js';

// "Open in the app" buttons for one recipient. In the "open_app" mode MAX
// opens the registered mini-app itself. In the "link" mode — while the
// mini-app is not registered for the bot — the button becomes a link to the
// app with a sign-in token of this recipient.
export function resolveAppButtons(buttons: CallbackButton[][], maxUserId: string): CallbackButton[][] {
  if (env.MINIAPP_OPEN_MODE !== 'link' || !env.MINIAPP_URL || !env.MAX_BOT_TOKEN) return buttons;
  if (!buttons.some((row) => row.some((button) => button.openApp))) return buttons;
  const token = signLinkToken(maxUserId, env.MAX_BOT_TOKEN);
  return buttons.map((row) => row.map((button) => {
    if (!button.openApp) return button;
    const url = new URL(env.MINIAPP_URL!);
    if (button.payload) url.searchParams.set('startapp', button.payload);
    url.searchParams.set('t', token);
    return { text: button.text, payload: button.payload, url: url.toString() };
  }));
}
