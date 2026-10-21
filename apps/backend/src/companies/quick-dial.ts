import { z } from 'zod';

// The short numbers residents call in one tap. A company may change the list
// for its houses (a local gas service, its own dispatcher); otherwise the
// numbers that work from any phone in Russia are shown.
export const defaultQuickDial = [
  { number: '112', title: 'Единый номер' },
  { number: '101', title: 'Пожарные' },
  { number: '102', title: 'Полиция' },
  { number: '103', title: 'Скорая' },
  { number: '104', title: 'Газовая служба' },
];

export const quickDialSchema = z.array(z.object({
  number: z.string().trim().min(2).max(20).regex(/^\+?[\d\s()-]+$/),
  title: z.string().trim().min(2).max(40),
})).max(8);

export type QuickDial = z.infer<typeof quickDialSchema>;

export function quickDialOf(stored: unknown): QuickDial {
  const parsed = quickDialSchema.safeParse(stored);
  return parsed.success && parsed.data.length ? parsed.data : defaultQuickDial;
}
