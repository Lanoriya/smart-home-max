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
  const base = { number: 1042, title: 'Не работает лифт', dueAt: null, delayReason: null } as const;

  it('includes the public incident number, title and status', () => {
    const text = notificationText({ ...base, status: 'resolved' }).value;
    expect(text).toContain('<b>Заявка № 1042: обновление</b>');
    expect(text).toContain('Не работает лифт');
    expect(text).toContain('Статус: <b>Устранена</b>');
  });

  it('shows the previous status and the new one', () => {
    const text = notificationText({ ...base, status: 'in_progress', previousStatus: 'acknowledged' }).value;
    expect(text).toContain('Статус: Принята → <b>В работе</b>');
  });

  it('does not show a planned deadline for terminal statuses', () => {
    const text = notificationText({ ...base, status: 'rejected', dueAt: new Date('2026-09-28T18:00:00.000Z'), rejectionReason: 'Дубль' }).value;
    expect(text).not.toContain('Плановый срок');
    expect(text).toContain('Причина отклонения: Дубль');
  });

  it('escapes the dispatcher comment so it cannot inject markup', () => {
    const text = notificationText({ ...base, status: 'in_progress', comment: 'Заменим <script>деталь</script> & кабель' }).value;
    expect(text).toContain('<b>Сообщение УК</b>\nЗаменим &lt;script&gt;деталь&lt;/script&gt; &amp; кабель');
  });
});
