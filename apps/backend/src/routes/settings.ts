import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireRole } from '../auth/session.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { env } from '../config/env.js';
import { prisma } from '../shared/prisma.js';

export const settingsRouter = Router();
settingsRouter.use(requireAdmin);

const codeSchema = z.object({ code: z.string().regex(/^\d{10}$/) });

settingsRouter.get('/uk-code', async (request, response, next) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    const item = await prisma.ukAccessCode.findUnique({ where: { id: 'main' } });
    const code = item?.code ?? env.RESIDENT_UK_CODE;
    if (request.query.reveal === 'true') {
      const admin = response.locals.admin as { id: string; role: string };
      if (admin.role !== 'supervisor') { response.status(403).json({ code: 'insufficient_permissions' }); return; }
      await writeAdminAudit(prisma, admin.id, 'uk_code_revealed', 'uk_access_code', 'main');
      response.json({ code, overridden: Boolean(item) });
    } else response.json({ maskedCode: '••••••••••', overridden: Boolean(item) });
  } catch (error) { next(error); }
});

settingsRouter.patch('/uk-code', requireRole('supervisor'), async (request, response, next) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_uk_code' }); return; }
    const admin = response.locals.admin as { id: string };
    await prisma.$transaction(async (tx) => {
      await tx.ukAccessCode.upsert({ where: { id: 'main' }, create: { id: 'main', code: parsed.data.code }, update: { code: parsed.data.code } });
      await writeAdminAudit(tx, admin.id, 'uk_code_changed', 'uk_access_code', 'main');
    });
    response.json({ maskedCode: '••••••••••' });
  } catch (error) { next(error); }
});
