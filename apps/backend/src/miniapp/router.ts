import { Router } from 'express';
import { z } from 'zod';
import { requireMiniAppUser, miniApp } from './auth.js';
import { residentRouter } from './resident.js';
import { neighboursRouter } from './neighbours.js';
import { companyRouter } from './company.js';
import { platformRouter } from './platform.js';
import { acceptInvite, invitePrefix, previewInvite } from './invites.js';
import { leaveAdmin } from '../auth/leave-admin.js';
import { requireMiniAppAdmin } from './auth.js';
import { lookupHouse, searchRegistryCompanies } from '../registry/lookup.js';
import { locateAddress, resolveAddress, suggestAddresses, suggestCities, type CityRef } from '../registry/geosearch.js';
import { residentPollsRouter } from '../polls/polls.js';
import { residentAppointmentsRouter } from '../appointments/appointments.js';

// API of the MAX mini-app. One app for every role: the screens a person sees
// depend on who they are in MAX — a resident, a company administrator or the
// platform administrator.

export const miniAppRouter = Router();
miniAppRouter.use(requireMiniAppUser);

const tokenSchema = z.object({ token: z.string().trim().min(10).max(200).transform((value) => value.startsWith(invitePrefix) ? value.slice(invitePrefix.length) : value) });

miniAppRouter.get('/invites/:token', async (request, response, next) => {
  try {
    const parsed = tokenSchema.safeParse({ token: request.params.token });
    if (!parsed.success) { response.status(404).json({ code: 'invite_not_found' }); return; }
    const invite = await previewInvite(parsed.data.token);
    if (!invite) { response.status(404).json({ code: 'invite_not_found' }); return; }
    response.json({ item: invite });
  } catch (error) { next(error); }
});

miniAppRouter.post('/invites/accept', async (request, response, next) => {
  try {
    const parsed = tokenSchema.safeParse(request.body);
    if (!parsed.success) { response.status(404).json({ code: 'invite_not_found' }); return; }
    const { user } = miniApp(response);
    const result = await acceptInvite(user, parsed.data.token);
    if (!result.ok) { response.status(result.code === 'invite_not_found' ? 404 : 409).json({ code: result.code }); return; }
    response.json(result);
  } catch (error) { next(error); }
});

// Giving up one's own access: a company employee or a platform administrator.
miniAppRouter.post('/admin/leave', async (_request, response, next) => {
  try {
    const actor = miniApp(response).admin;
    if (!actor) { response.status(404).json({ code: 'admin_not_found' }); return; }
    const result = await leaveAdmin(actor.id);
    if (!result.ok) { response.status(result.code === 'admin_not_found' ? 404 : 409).json({ code: result.code }); return; }
    response.json(result);
  } catch (error) { next(error); }
});

const pointSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

// A house recognised by a tap on the map: address from OpenStreetMap, details
// from the open housing registry, and whether it is already in the service.
miniAppRouter.post('/lookup', requireMiniAppAdmin(), async (request, response, next) => {
  try {
    const parsed = pointSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_point' }); return; }
    response.json(await lookupHouse(parsed.data.latitude, parsed.data.longitude));
  } catch (error) { next(error); }
});

const registrySearchSchema = z.object({ q: z.string().trim().min(2).max(200), subject: z.string().trim().max(200).optional(), city: z.string().trim().min(2).max(100).optional() });

// Management companies of the open registry, by name or INN.
miniAppRouter.get('/registry/companies', requireMiniAppAdmin(), async (request, response, next) => {
  try {
    const parsed = registrySearchSchema.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_query' }); return; }
    response.json({ items: await searchRegistryCompanies(parsed.data.q, parsed.data.subject, parsed.data.city) });
  } catch (error) { next(error); }
});

// Any city and any street or house in it, for the address field above maps.
const citiesQuery = z.object({ q: z.string().trim().min(2).max(100) });
miniAppRouter.get('/geo/cities', async (request, response, next) => {
  try {
    const parsed = citiesQuery.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_query' }); return; }
    response.json({ items: await suggestCities(parsed.data.q) });
  } catch (error) { next(error); }
});

const cityParams = z.object({
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(150).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  // west,north,east,south
  extent: z.string().regex(/^-?[\d.]+(,-?[\d.]+){3}$/).optional(),
});

function cityFrom(params: z.infer<typeof cityParams>): CityRef {
  const extent = params.extent?.split(',').map(Number) as [number, number, number, number] | undefined;
  return { name: params.city, region: params.region ?? null, latitude: params.lat, longitude: params.lng, extent: extent ?? null };
}

const addressesQuery = cityParams.partial().extend({ q: z.string().trim().min(2).max(150) });
miniAppRouter.get('/geo/addresses', async (request, response, next) => {
  try {
    const parsed = addressesQuery.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_query' }); return; }
    const city = cityParams.safeParse(parsed.data);
    response.json({ items: await suggestAddresses(parsed.data.q, city.success ? cityFrom(city.data) : undefined) });
  } catch (error) { next(error); }
});

// The point of a written address, for the office of a company.
miniAppRouter.get('/geo/locate', async (request, response, next) => {
  try {
    const parsed = z.object({ q: z.string().trim().min(5).max(300) }).safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_query' }); return; }
    const item = await locateAddress(parsed.data.q);
    if (!item) { response.status(404).json({ code: 'address_not_found' }); return; }
    response.json({ item });
  } catch (error) { next(error); }
});

// A precise search of the typed address, when the person presses "Найти".
const resolveQuery = cityParams.extend({ q: z.string().trim().min(2).max(150) });
miniAppRouter.get('/geo/resolve', async (request, response, next) => {
  try {
    const parsed = resolveQuery.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_query' }); return; }
    const item = await resolveAddress(parsed.data.q, cityFrom(parsed.data));
    if (!item) { response.status(404).json({ code: 'address_not_found' }); return; }
    response.json({ item });
  } catch (error) { next(error); }
});

miniAppRouter.use('/company', companyRouter);
miniAppRouter.use('/polls', residentPollsRouter);
miniAppRouter.use('/appointments', residentAppointmentsRouter);
miniAppRouter.use('/platform', platformRouter);
miniAppRouter.use('/neighbours', neighboursRouter);
miniAppRouter.use('/', residentRouter);
