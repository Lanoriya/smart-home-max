import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { blocks, bold } from '../shared/html.js';
import { writeAdminAudit } from '../auth/admin-audit.js';
import { requireCompanyId } from '../auth/scope.js';
import { miniApp } from '../miniapp/auth.js';
import { companyZone, localTime, offsetLabel } from '../shared/time-zone.js';

// Polls of a management company. The company asks a question with 2 to 15
// answers, for all its houses or for one, until a set time. One apartment has
// one vote; the company decides whether a vote may be changed. In an
// anonymous poll residents see only how many apartments chose each answer;
// in a public one they also see which apartments. The company always sees
// the apartments: it has to know whom the decision concerns.

type Option = { id: string; text: string };
type PollRow = Prisma.PollGetPayload<{ include: { building: { select: { address: true } }; votes: { include: { apartment: { select: { number: true; building: { select: { address: true } } } } } } } }>;

const pollInclude = {
  building: { select: { address: true } },
  votes: { include: { apartment: { select: { number: true, building: { select: { address: true } } } } } },
} as const;

const optionsOf = (poll: { options: unknown }) => poll.options as Option[];
const isActive = (poll: { endsAt: Date; closedAt: Date | null }, now = new Date()) => !poll.closedAt && poll.endsAt > now;

function serialize(poll: PollRow, viewer: { apartmentId: string | null; company: boolean }, zone: string) {
  const mine = viewer.apartmentId ? poll.votes.find((vote) => vote.apartmentId === viewer.apartmentId) ?? null : null;
  const active = isActive(poll);
  // Residents see the results after their apartment voted or when the poll is over.
  const showResults = viewer.company || Boolean(mine) || !active;
  const showApartments = viewer.company || !poll.anonymous;
  const allHouses = !poll.buildingId;
  return {
    id: poll.id,
    question: poll.question,
    scope: poll.building?.address ?? 'Все дома УК',
    buildingId: poll.buildingId,
    anonymous: poll.anonymous,
    allowChange: poll.allowChange,
    endsAt: poll.endsAt,
    closedAt: poll.closedAt,
    timeZone: zone,
    zoneLabel: offsetLabel(poll.endsAt, zone),
    createdAt: poll.createdAt,
    active,
    votes: poll.votes.length,
    myOptionId: mine?.optionId ?? null,
    canVote: active && Boolean(viewer.apartmentId) && (!mine || poll.allowChange),
    showResults,
    options: optionsOf(poll).map((option) => {
      const chosen = poll.votes.filter((vote) => vote.optionId === option.id);
      return {
        id: option.id,
        text: option.text,
        ...(showResults ? { count: chosen.length } : {}),
        ...(showResults && showApartments ? {
          apartments: chosen.map((vote) => (allHouses ? `${vote.apartment.building.address}, кв. ${vote.apartment.number}` : `кв. ${vote.apartment.number}`))
            .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true })),
        } : {}),
      };
    }),
  };
}

function membershipOf(userId: string) {
  return prisma.residentMembership.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { verifiedAt: 'desc' },
    select: { apartmentId: true, apartment: { select: { buildingId: true, building: { select: { companyId: true } } } } },
  });
}

// The polls a resident sees: their company's, for all houses or their own.
function residentPollsWhere(membership: NonNullable<Awaited<ReturnType<typeof membershipOf>>>) {
  return {
    companyId: membership.apartment.building.companyId,
    OR: [{ buildingId: null }, { buildingId: membership.apartment.buildingId }],
    createdAt: { gte: new Date(Date.now() - 90 * 24 * 3_600_000) },
  };
}

export async function unvotedPolls(userId: string) {
  const membership = await membershipOf(userId);
  if (!membership) return 0;
  return prisma.poll.count({
    where: { ...residentPollsWhere(membership), closedAt: null, endsAt: { gt: new Date() }, votes: { none: { apartmentId: membership.apartmentId } } },
  });
}

// ---------- residents ----------

export const residentPollsRouter = Router();

residentPollsRouter.get('/', async (_request, response, next) => {
  try {
    // Open polls first, then the finished ones.
    response.json({ items: await pollsFor(miniApp(response).user.id) });
  } catch (error) { next(error); }
});

// A vote of the apartment of the user, from the app or from the bot.
export async function castVote(userId: string, pollId: string, optionId: string) {
  const membership = await membershipOf(userId);
  if (!membership) return { ok: false as const, code: 'residence_required' };
  const poll = await prisma.poll.findFirst({ where: { id: pollId, ...residentPollsWhere(membership) } });
  if (!poll) return { ok: false as const, code: 'poll_not_found' };
  if (!isActive(poll)) return { ok: false as const, code: 'poll_closed' };
  if (!optionsOf(poll).some((option) => option.id === optionId)) return { ok: false as const, code: 'invalid_vote' };
  const vote = { pollId: poll.id, apartmentId: membership.apartmentId, userId, optionId };
  if (poll.allowChange) {
    await prisma.pollVote.upsert({ where: { pollId_apartmentId: { pollId: poll.id, apartmentId: membership.apartmentId } }, create: vote, update: { userId, optionId } });
  } else {
    // A final vote is only inserted: the unique key of the poll and the
    // apartment lets one of two simultaneous votes in, never overwrites it.
    const inserted = await prisma.pollVote.createMany({ data: [vote], skipDuplicates: true });
    if (!inserted.count) return { ok: false as const, code: 'vote_final' };
  }
  return { ok: true as const, item: await pollFor(userId, poll.id) };
}

// One poll as the user sees it, or null when it is not theirs.
export async function pollFor(userId: string, pollId: string) {
  const membership = await membershipOf(userId);
  if (!membership) return null;
  const poll = await prisma.poll.findFirst({ where: { id: pollId, ...residentPollsWhere(membership) }, include: pollInclude });
  return poll ? serialize(poll, { apartmentId: membership.apartmentId, company: false }, await companyZone(poll.companyId)) : null;
}

export async function pollsFor(userId: string) {
  const membership = await membershipOf(userId);
  if (!membership) return [];
  const polls = await prisma.poll.findMany({ where: residentPollsWhere(membership), include: pollInclude, orderBy: { createdAt: 'desc' }, take: 50 });
  const zone = await companyZone(membership.apartment.building.companyId);
  const items = polls.map((poll) => serialize(poll, { apartmentId: membership.apartmentId, company: false }, zone));
  items.sort((left, right) => Number(right.active) - Number(left.active));
  return items;
}

residentPollsRouter.post('/:id/vote', async (request, response, next) => {
  try {
    const parsed = z.object({ optionId: z.string().min(1).max(60) }).safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ code: 'invalid_vote' }); return; }
    const result = await castVote(miniApp(response).user.id, String(request.params.id), parsed.data.optionId);
    if (!result.ok) {
      const status = result.code === 'poll_not_found' ? 404 : result.code === 'invalid_vote' ? 400 : 409;
      response.status(status).json({ code: result.code });
      return;
    }
    response.json({ item: result.item });
  } catch (error) { next(error); }
});

// ---------- the company ----------

export const companyPollsRouter = Router();

const companyOf = (response: Parameters<typeof miniApp>[0]) => requireCompanyId(miniApp(response).admin!, response.locals.companyId);

const createSchema = z.object({
  question: z.string().trim().min(3).max(300),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(15)
    .refine((options) => new Set(options.map((option) => option.toLowerCase())).size === options.length, { message: 'Options repeat' }),
  buildingId: z.string().uuid().nullable().optional(),
  endsAt: z.coerce.date(),
  anonymous: z.boolean().default(false),
  allowChange: z.boolean().default(true),
});

companyPollsRouter.get('/', async (_request, response, next) => {
  try {
    const companyId = companyOf(response);
    const polls = await prisma.poll.findMany({ where: { companyId }, include: pollInclude, orderBy: { createdAt: 'desc' }, take: 100 });
    const zone = await companyZone(companyId);
    // Turnout: apartments of the houses the poll is for.
    const buildings = await prisma.building.findMany({ where: { companyId }, select: { id: true, apartmentsCount: true } });
    const allApartments = buildings.reduce((sum, building) => sum + building.apartmentsCount, 0);
    response.json({
      items: polls.map((poll) => ({
        ...serialize(poll, { apartmentId: null, company: true }, zone),
        apartmentsTotal: poll.buildingId ? buildings.find((building) => building.id === poll.buildingId)?.apartmentsCount ?? 0 : allApartments,
      })),
    });
  } catch (error) { next(error); }
});

companyPollsRouter.post('/', async (request, response, next) => {
  try {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ code: 'invalid_poll' }); return; }
    const companyId = companyOf(response);
    const { question, options, buildingId, endsAt, anonymous, allowChange } = parsed.data;
    if (endsAt.getTime() < Date.now() + 10_000 || endsAt.getTime() > Date.now() + 90 * 24 * 3_600_000) { response.status(400).json({ code: 'poll_ends_at' }); return; }
    if (buildingId && !await prisma.building.findFirst({ where: { id: buildingId, companyId }, select: { id: true } })) { response.status(404).json({ code: 'building_not_found' }); return; }
    const recipients = await prisma.residentMembership.findMany({
      where: { revokedAt: null, apartment: buildingId ? { buildingId } : { building: { companyId } } },
      distinct: ['userId'],
      select: { user: { select: { maxUserId: true } } },
    });
    const actor = miniApp(response).admin!;
    const zone = await companyZone(companyId);
    const poll = await prisma.$transaction(async (tx) => {
      const created = await tx.poll.create({
        data: { companyId, buildingId: buildingId ?? null, question, options: options.map((text) => ({ id: randomUUID().slice(0, 8), text })), endsAt, anonymous, allowChange, createdById: actor.id },
      });
      const until = localTime(endsAt, zone);
      const text = blocks(
        [bold('📊 Новый опрос от управляющей компании')],
        [question],
        [`Голосование до ${until}. ${anonymous ? 'Опрос анонимный: соседи не увидят, как проголосовала ваша квартира.' : 'Опрос открытый: соседи увидят, какие квартиры за что проголосовали.'}`],
      ).value;
      if (recipients.length) {
        await tx.outboxMessage.createMany({
          data: recipients.map(({ user }) => ({ type: 'poll_created', payload: { userId: user.maxUserId, text, format: 'html', buttons: pollButtons(created.id, optionsOf(created)) } })),
        });
      }
      await writeAdminAudit(tx, actor.id, 'poll_created', 'poll', created.id, { buildingId: buildingId ?? null, options: options.length, recipients: recipients.length });
      return created;
    });
    response.status(201).json({ id: poll.id, recipients: recipients.length });
  } catch (error) { next(error); }
});

companyPollsRouter.post('/:id/close', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'poll_not_found' }); return; }
    const closed = await prisma.poll.updateMany({ where: { id: String(request.params.id), companyId: companyOf(response), closedAt: null }, data: { closedAt: new Date() } });
    if (!closed.count) { response.status(404).json({ code: 'poll_not_found' }); return; }
    await writeAdminAudit(prisma, miniApp(response).admin!.id, 'poll_closed', 'poll', String(request.params.id));
    response.status(204).end();
  } catch (error) { next(error); }
});

companyPollsRouter.delete('/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).json({ code: 'poll_not_found' }); return; }
    const removed = await prisma.poll.deleteMany({ where: { id: String(request.params.id), companyId: companyOf(response) } });
    if (!removed.count) { response.status(404).json({ code: 'poll_not_found' }); return; }
    await writeAdminAudit(prisma, miniApp(response).admin!.id, 'poll_deleted', 'poll', String(request.params.id));
    response.status(204).end();
  } catch (error) { next(error); }
});

// The answers as buttons of the bot: a tap votes without opening the app.
export function pollButtons(pollId: string, options: Array<{ id: string; text: string; mine?: boolean }>) {
  return [
    ...options.map((option) => [{ text: `${option.mine ? '✓ ' : ''}${option.text.length > 60 ? `${option.text.slice(0, 59)}…` : option.text}`, payload: `poll:vote:${pollId}:${option.id}` }]),
    [{ text: 'Открыть в приложении', payload: `poll_${pollId}`, openApp: true }],
    [{ text: 'Все опросы', payload: 'polls:list' }, { text: 'В главное меню', payload: 'menu:main' }],
  ];
}
