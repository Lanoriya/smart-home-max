import { Router } from 'express';
import { requireAdmin } from '../auth/session.js';
import type { AdminActor } from '../auth/scope.js';
import {
  deleteIncidentComment,
  getIncident,
  listFiltersSchema,
  listIncidents,
  patchIncidentSchema,
  updateIncident,
} from '../incidents/admin-incidents.js';
import { requireUuidParams } from '../shared/params.js';
import { createPhoneIncident, phoneIncidentSchema } from '../incidents/phone-intake.js';

export { canTransition, notificationText } from '../incidents/admin-incidents.js';

export const incidentsRouter = Router();
incidentsRouter.use(requireAdmin);
requireUuidParams(incidentsRouter, 'id', 'commentId');

incidentsRouter.get('/', async (request, response, next) => {
  try {
    const filters = listFiltersSchema.safeParse(request.query);
    if (!filters.success) { response.status(400).json({ code: 'invalid_incident_filter' }); return; }
    response.json({ items: await listIncidents(response.locals.companyId, filters.data) });
  } catch (error) {
    next(error);
  }
});

// A dispatcher registers an incident from a phone call.
incidentsRouter.post('/', async (request, response, next) => {
  try {
    const parsed = phoneIncidentSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_incident', details: parsed.error.flatten() }); return; }
    const result = await createPhoneIncident(response.locals.admin as AdminActor, response.locals.companyId, parsed.data);
    if (!result.ok) { response.status(result.code === 'building_not_found' || result.code === 'apartment_not_found' ? 404 : 400).json({ code: result.code }); return; }
    const { ok: _ok, ...body } = result;
    response.status(201).json(body);
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get('/:id', async (request, response, next) => {
  try {
    const incident = await getIncident(response.locals.companyId, request.params.id);
    if (!incident) {
      response.status(404).json({ code: 'incident_not_found' });
      return;
    }
    response.json({ item: incident });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.delete('/:id/comments/:commentId', async (request, response, next) => {
  try {
    const admin = response.locals.admin as AdminActor;
    const deleted = await deleteIncidentComment(admin, response.locals.companyId, request.params.id, request.params.commentId);
    if (!deleted) { response.status(404).json({ code: 'comment_not_found' }); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});

incidentsRouter.patch('/:id', async (request, response, next) => {
  try {
    const parsed = patchIncidentSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'invalid_incident_patch', details: parsed.error.flatten() });
      return;
    }
    const result = await updateIncident(response.locals.admin as AdminActor, response.locals.companyId, request.params.id, parsed.data);
    if (!result.ok) {
      const { status, ok: _ok, ...body } = result;
      response.status(status).json(body);
      return;
    }
    response.json({ item: result.item });
  } catch (error) {
    next(error);
  }
});
