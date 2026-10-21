import { describe, expect, it } from 'vitest';
import { getMaxContact, getMaxUsername, maxUpdateSchema } from '../src/bot/max-update.js';

const message = (attachments: unknown[], sender: Record<string, unknown> = { user_id: 42 }) => maxUpdateSchema.parse({
  update_type: 'message_created', timestamp: 1, message: { sender, body: { mid: 'm1', text: null, attachments } },
});

describe('contact shared from MAX', () => {
  it('reads the phone from the vCard and the owner from the MAX profile', () => {
    const contact = getMaxContact(message([{ type: 'contact', payload: { vcf_info: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Андрей\r\nTEL;TYPE=cell:+79001234567\r\nEND:VCARD', max_info: { user_id: 42, name: 'Андрей' } } }]));
    expect(contact).toMatchObject({ phone: '+79001234567', ownerId: '42' });
  });

  it('accepts a plain phone field as well', () => {
    expect(getMaxContact(message([{ type: 'contact', payload: { phone: '8 900 765-43-21' } }]))?.phone).toBe('8 900 765-43-21');
  });

  it('reports the owner of a forwarded contact so it can be refused', () => {
    expect(getMaxContact(message([{ type: 'contact', payload: { vcf_info: 'TEL:+79000000000', max_info: { user_id: 7 } } }]))?.ownerId).toBe('7');
  });

  it('ignores messages without a contact and never logs the phone itself', () => {
    expect(getMaxContact(message([{ type: 'image', payload: { token: 't' } }]))).toBeNull();
    const contact = getMaxContact(message([{ type: 'contact', payload: { vcf_info: 'TEL:+79001234567', max_info: { user_id: 42 } } }]));
    expect(contact?.attachmentShape).not.toContain('79001234567');
  });

  it('takes the nick from the MAX profile', () => {
    expect(getMaxUsername(message([], { user_id: 42, username: '@andrew_k' }))).toBe('andrew_k');
    expect(getMaxUsername(message([], { user_id: 42 }))).toBeNull();
  });
});
