import { describe, expect, it } from 'vitest';
import { findMatchingIncidents, titleFromDraft } from '../src/incidents/incident-service.js';

describe('incident title', () => {
  it('uses a short resident description as-is', () => {
    expect(titleFromDraft({ category: 'elevator', description: 'Не работает лифт' }))
      .toBe('Не работает лифт');
  });

  it('limits a title to 70 characters', () => {
    const title = titleFromDraft({ category: 'other', description: 'а'.repeat(100) });
    expect(title).toHaveLength(70);
    expect(title.endsWith('...')).toBe(true);
  });

  it('never searches for matches for a private apartment incident', async () => {
    const database = {
      incident: {
        findMany: () => {
          throw new Error('Private incident must not query public matches');
        },
      },
    };
    await expect(findMatchingIncidents('user-id', {
      buildingId: 'building-id',
      apartmentId: 'apartment-id',
      category: 'water',
      locationZone: 'apartment',
      description: 'Протекает кран',
    }, database as never)).resolves.toEqual([]);
  });
});
