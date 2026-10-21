import { z } from 'zod';

// An optional text field of a form: trimmed, empty becomes null.
export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
