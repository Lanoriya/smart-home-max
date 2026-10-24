import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../shared/prisma.js';
import { houseLink, houseQrPng } from '../buildings/house-link.js';

// The QR code of a house as a PNG, for the bot: it sends the picture by this
// address. Public, like the link inside it: the code gives no access.

export const houseQrRouter = Router();

houseQrRouter.get('/house/:file', async (request, response, next) => {
  try {
    const id = /^(.+)\.png$/.exec(String(request.params.file))?.[1];
    if (!id || !z.string().uuid().safeParse(id).success) { response.status(404).end(); return; }
    const building = await prisma.building.findUnique({ where: { id }, select: { id: true } });
    const link = building ? houseLink(building.id) : null;
    if (!link) { response.status(404).end(); return; }
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.end(await houseQrPng(link));
  } catch (error) { next(error); }
});
