export type CallbackButton = {
  text: string;
  payload: string;
  intent?: 'default' | 'positive' | 'negative';
};

export type ImageAttachment = { token: string; url?: string };

export interface Messenger {
  sendMessageToUser(
    userId: string,
    text: string,
    buttons?: CallbackButton[][],
    images?: ImageAttachment[],
  ): Promise<void>;
  answerCallback?(callbackId: string): Promise<void>;
}
