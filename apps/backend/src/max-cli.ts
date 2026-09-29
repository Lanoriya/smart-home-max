import { env } from './config/env.js';
import { MaxApiError, MaxMessenger } from './bot/max-client.js';

const command = process.argv[2] ?? 'check';
const messenger = new MaxMessenger();

async function main() {
  if (env.MAX_MODE !== 'api') {
    throw new Error('Set MAX_MODE=api before using MAX API commands');
  }

  if (command === 'check') {
    const [bot, subscriptions] = await Promise.all([
      messenger.getMe(),
      messenger.getWebhookSubscriptions(),
    ]);
    console.log(JSON.stringify({ bot, subscriptions }, null, 2));
    return;
  }

  if (command === 'subscribe') {
    if (!env.MAX_PUBLIC_WEBHOOK_URL) {
      throw new Error('MAX_PUBLIC_WEBHOOK_URL is not configured');
    }
    const result = await messenger.createWebhookSubscription(
      env.MAX_PUBLIC_WEBHOOK_URL,
      env.MAX_WEBHOOK_SECRET,
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown MAX command: ${command}`);
}

main().catch((error) => {
  if (error instanceof MaxApiError) {
    console.error(
      JSON.stringify(
        { error: error.message, status: error.status, response: error.responseBody },
        null,
        2,
      ),
    );
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
