import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { prisma } from '../shared/prisma.js';
import { formatRussianPhone, normalizeRussianPhone } from '../shared/phone.js';
import { requireCompanyId, type AdminActor } from '../auth/scope.js';
import { dutiesFor, dutiesSchema, platformDuties, saveCompanyDuties } from '../companies/duties.js';
import { optionalText } from '../shared/text.js';

export const settingsRouter = Router();
settingsRouter.use(requireAdmin);


const ukContactSchema = z.object({
  name: z.string().trim().min(2).max(200),
  // Stored in one readable format so residents see the same number everywhere.
  phone: z.string().trim().max(40).transform((value, context) => {
    const normalized = normalizeRussianPhone(value);
    if (!normalized) {
      context.addIssue({ code: 'custom', message: 'Expected a Russian phone number' });
      return z.NEVER;
    }
    return formatRussianPhone(normalized);
  }),
  email: z.union([z.literal(''), z.null(), z.string().trim().max(200).email()]).optional().transform((value) => value || null),
  address: optionalText(300),
  workingHours: optionalText(300),
  receptionHours: optionalText(300),
  daysOff: optionalText(200),
  cleaningInfo: optionalText(1500),
  note: optionalText(1000),
});

settingsRouter.get('/duties', async (_request, response, next) => {
  try {
    const companyId = requireCompanyId(response.locals.admin as AdminActor, response.locals.companyId);
    response.json({ ...(await dutiesFor(companyId)), platform: await platformDuties() });
  } catch (error) { next(error); }
});

settingsRouter.put('/duties', async (request, response, next) => {
  try {
    const parsed = z.object({ items: dutiesSchema.nullable() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_duties' }); return; }
    const admin = response.locals.admin as AdminActor;
    const companyId = requireCompanyId(admin, response.locals.companyId);
    const saved = await saveCompanyDuties(companyId, parsed.data.items);
    await writeAdminAudit(prisma, admin.id, 'duties_updated', 'management_company', companyId);
    response.json(saved);
  } catch (error) { next(error); }
});

// The contacts of the acting company, shown to its residents.
settingsRouter.get('/uk-contacts', async (_request, response, next) => {
  try {
    const companyId = requireCompanyId(response.locals.admin as AdminActor, response.locals.companyId);
    const item = await prisma.managementCompany.findUnique({ where: { id: companyId } });
    response.json({ item });
  } catch (error) { next(error); }
});

settingsRouter.put('/uk-contacts', async (request, response, next) => {
  try {
    const parsed = ukContactSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_uk_contacts', details: parsed.error.flatten() }); return; }
    const admin = response.locals.admin as AdminActor;
    const companyId = requireCompanyId(admin, response.locals.companyId);
    const item = await prisma.$transaction(async (tx) => {
      const saved = await tx.managementCompany.update({ where: { id: companyId }, data: parsed.data });
      await writeAdminAudit(tx, admin.id, 'uk_contacts_updated', 'management_company', companyId);
      return saved;
    });
    response.json({ item });
  } catch (error) { next(error); }
});
