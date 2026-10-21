import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { prisma } from '../shared/prisma.js';

// Photos sent from the mini-app are files on a volume, not rows of base64 in
// the database: the database stays small and an incident card carries only
// the short address /api/photos/<id> of each photo.

const dataUrlPattern = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export function photoBytesOf(dataUrl: string): Buffer | null {
  const match = dataUrlPattern.exec(dataUrl);
  return match ? Buffer.from(match[1]!, 'base64') : null;
}

// The address of an app photo inside the service, kept in its url field.
export function appPhotoPath(photoId: string) {
  return `/api/photos/${photoId}`;
}

const fileOf = (photoId: string) => join(env.PHOTOS_DIR, photoId);

export async function savePhotoFile(photoId: string, bytes: Buffer) {
  await mkdir(env.PHOTOS_DIR, { recursive: true });
  // Written next to the target and renamed: a half-written file is never served.
  const temporary = `${fileOf(photoId)}.part`;
  await writeFile(temporary, bytes);
  await rename(temporary, fileOf(photoId));
}

export async function readPhotoFile(photoId: string): Promise<Buffer | null> {
  try {
    return await readFile(fileOf(photoId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function deletePhotoFiles(photoIds: string[]) {
  await Promise.all(photoIds.map((photoId) => unlink(fileOf(photoId)).catch(() => undefined)));
}

// The type of an image by its first bytes.
export function photoMimeOf(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// Photos saved before the files existed are moved out of the database once.
export async function moveLegacyPhotos() {
  let moved = 0;
  for (;;) {
    const batch = await prisma.incidentPhoto.findMany({
      where: { token: { startsWith: 'app:' }, url: { startsWith: 'data:' } },
      select: { id: true, url: true },
      take: 20,
    });
    if (!batch.length) break;
    for (const photo of batch) {
      const bytes = photoBytesOf(photo.url ?? '');
      if (bytes) await savePhotoFile(photo.id, bytes);
      await prisma.incidentPhoto.update({ where: { id: photo.id }, data: { url: bytes ? appPhotoPath(photo.id) : null } });
      moved += 1;
    }
  }
  if (moved) logger.info({ moved }, 'Photos moved from the database to files');
  return moved;
}
