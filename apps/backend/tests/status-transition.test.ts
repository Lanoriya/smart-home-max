import { describe, expect, it } from 'vitest';
import { canTransition, notificationText } from '../src/routes/incidents.js';

describe('incident status transitions', () => {
  it('allows the normal workflow', () => {
    expect(canTransition('new', 'acknowledged')).toBe(true);
    expect(canTransition('acknowledged', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
  });

  it('allows a dispatcher to resolve an incident immediately', () => {
    expect(canTransition('new', 'resolved')).toBe(true);
    expect(canTransition('acknowledged', 'resolved')).toBe(true);
  });

  it('allows a dispatcher to jump between statuses', () => {
    expect(canTransition('resolved', 'new')).toBe(true);
    expect(canTransition('rejected', 'in_progress')).toBe(true);
  });
});

describe('incident notifications', () => {
  it('includes the public incident number', () => {
    const text = notificationText(
      'f55bcb0d-79a6-4fd0-bd17-8f2b69bf1499',
      'resolved',
      null,
      null,
    );
    expect(text).toContain('Инцидент №F55BCB0D');
    expect(text).toContain('Устранена');
  });

  it('does not show a planned deadline for terminal statuses', () => {
    const text = notificationText('f55bcb0d-79a6-4fd0-bd17-8f2b69bf1499', 'rejected', new Date('2026-09-28T18:00:00.000Z'), null, undefined, 'Дубль');
    expect(text).not.toContain('Плановый срок');
    expect(text).toContain('Причина отклонения: Дубль');
  });
});
