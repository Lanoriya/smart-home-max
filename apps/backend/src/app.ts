import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './shared/logger.js';
import { healthRouter } from './routes/health.js';
import { incidentsRouter } from './routes/incidents.js';
import { maxWebhookRouter } from './routes/max-webhook.js';
import { adminSessionRouter } from './routes/admin-session.js';
import { buildingsRouter } from './routes/buildings.js';
import { announcementsRouter } from './routes/announcements.js';
import { emergencyServicesRouter } from './routes/emergency-services.js';
import { apartmentsRouter } from './routes/apartments.js';
import { settingsRouter } from './routes/settings.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY_HOPS > 0) app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(
    cors({
      origin: env.ADMIN_WEB_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (request: IncomingMessage, response: ServerResponse) => {
        const requestId = request.headers['x-request-id']?.toString() ?? randomUUID();
        response.setHeader('x-request-id', requestId);
        return requestId;
      },
    }),
  );

  app.use('/health', healthRouter);
  app.use('/webhooks/max', maxWebhookRouter);
  app.use('/api/admin/session', adminSessionRouter);
  app.use('/api/incidents', incidentsRouter);
  app.use('/api/buildings', buildingsRouter);
  app.use('/api/announcements', announcementsRouter);
  app.use('/api/emergency-services', emergencyServicesRouter);
  app.use('/api/apartments', apartmentsRouter);
  app.use('/api/settings', settingsRouter);

  app.use((_request, response) => {
    response.status(404).json({ code: 'not_found' });
  });

  // Express identifies error middleware by all four arguments. Keep `next` even
  // though the error is handled here, otherwise thrown async route errors can
  // escape as a framework default response.
  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    request.log.error({ error }, 'Unhandled request error');
    if (response.headersSent) return;
    response.status(500).json({
      code: 'internal_error',
      requestId: request.id,
    });
  });

  return app;
}
