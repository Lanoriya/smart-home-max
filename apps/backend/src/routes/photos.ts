import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../shared/prisma.js';
import { photoBytesOf, photoMimeOf, readPhotoFile } from '../photos/storage.js';

// Photos sent from the mini-app are kept inside the incident. MAX takes an
// image for a message only by an address, so each such photo has one here.
// The address is the random id of the photo: it cannot be guessed.

export const photosRouter = Router();

photosRouter.get('/:id', async (request, response, next) => {
  try {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(404).end(); return; }
    const photo = await prisma.incidentPhoto.findUnique({ where: { id: request.params.id }, select: { token: true, url: true } });
    if (!photo?.token.startsWith('app:')) { response.status(404).end(); return; }
    // A file on the volume; a photo not moved out of the database yet still
    // comes from its data URL.
    const bytes = await readPhotoFile(request.params.id) ?? photoBytesOf(photo.url ?? '');
    const type = bytes ? photoMimeOf(bytes) : null;
    if (!bytes || !type) { response.status(404).end(); return; }
    response.setHeader('Content-Type', type);
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.end(bytes);
  } catch (error) { next(error); }
});

// The public address of an app photo, when the service knows its own address.
export function publicPhotoUrl(photoId: string) {
  return env.MINIAPP_URL ? new URL(`/api/photos/${photoId}`, env.MINIAPP_URL).toString() : null;
}
