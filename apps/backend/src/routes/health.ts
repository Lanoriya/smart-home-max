import { Router } from 'express';
import { prisma } from '../shared/prisma.js';

export const healthRouter = Router();

healthRouter.get('/live', (_request, response) => {
  response.json({ status: 'ok' });
});

healthRouter.get('/ready', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: 'ready' });
  } catch {
    response.status(503).json({ status: 'not_ready' });
  }
});
