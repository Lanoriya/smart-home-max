import type { Html } from '../shared/html.js';

export type CallbackButton = {
  text: string;
  payload: string;
  intent?: 'default' | 'positive' | 'negative';
  // A link button opens the URL instead of sending the payload to the bot.
  url?: string;
  // Asks MAX to send the resident's own contact (phone) to the bot.
  requestContact?: boolean;
  // Opens the bot's mini-app; the payload becomes its start parameter.
  // Dropped silently when the mini-app is not configured.
  openApp?: boolean;
};

export type ImageAttachment = { token: string; url?: string };

export interface Messenger {
  sendMessageToUser(
    userId: string,
    text: string | Html,
    buttons?: CallbackButton[][],
    images?: ImageAttachment[],
  ): Promise<string | null>;
  editMessage?(messageId: string, text: string | Html, buttons?: CallbackButton[][]): Promise<void>;
  deleteMessage?(messageId: string): Promise<void>;
}
