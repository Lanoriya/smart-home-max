import type { Router } from 'express';
import { z } from 'zod';

const uuid = z.string().uuid();

// Ids in the address are UUIDs. Anything else is answered as "not found"
// before it reaches the database, which would fail on it with an error.
export function requireUuidParams(router: Router, ...names: string[]) {
  for (const name of names) {
    router.param(name, (_request, response, next, value: string) => {
      if (uuid.safeParse(value).success) { next(); return; }
      response.status(404).json({ code: 'not_found' });
    });
  }
}
