import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './shared/logger.js';
import { prisma } from './shared/prisma.js';

const app = createApp();
const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT, maxMode: env.MAX_MODE }, 'Backend started');
});
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down backend');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
