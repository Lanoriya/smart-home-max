import { describe, expect, it } from 'vitest';
import { keyboardAttachments } from '../src/bot/max-client.js';
import { actingCompanyId, requireCompanyId, CompanyRequiredError } from '../src/auth/scope.js';

describe('open the mini-app from the bot', () => {
  const buttons = [
    [{ text: 'Открыть заявку', payload: 'incident:view:1' }],
    [{ text: 'Открыть в приложении', payload: 'incident_7', openApp: true }],
  ];

  it('sends an open_app button with the bot nick and the start parameter', () => {
    const [keyboard] = keyboardAttachments(buttons, 'domoved_bot');
    expect(keyboard?.payload.buttons[1]).toEqual([{ type: 'open_app', text: 'Открыть в приложении', web_app: 'domoved_bot', payload: 'incident_7' }]);
  });

  it('leaves the button out when the bot nick is not configured', () => {
    const [keyboard] = keyboardAttachments(buttons, '');
    expect(keyboard?.payload.buttons).toEqual([[{ type: 'callback', text: 'Открыть заявку', payload: 'incident:view:1' }]]);
  });
});

describe('company scope of administrators', () => {
  const companyAdmin = { id: 'a', username: 'a', role: 'dispatcher' as const, companyId: 'c1' };
  const platformAdmin = { id: 'p', username: 'p', role: 'platform_admin' as const, companyId: null };

  it('keeps a company administrator inside their company whatever they ask', () => {
    expect(actingCompanyId(companyAdmin, 'c2')).toBe('c1');
  });

  it('lets the platform administrator choose a company or see all', () => {
    expect(actingCompanyId(platformAdmin, 'c2')).toBe('c2');
    expect(actingCompanyId(platformAdmin, null)).toBeNull();
    expect(() => requireCompanyId(platformAdmin, null)).toThrow(CompanyRequiredError);
  });
});
