import { describe, expect, it, vi } from 'vitest';
import { requireRole } from '../src/auth/session.js';

function responseFor(role: 'dispatcher' | 'supervisor') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { response: { locals: { admin: { role } }, status } as never, status, json };
}

describe('administrator role guard', () => {
  it('allows a supervisor', () => {
    const { response, status } = responseFor('supervisor');
    const next = vi.fn();
    requireRole('supervisor')({} as never, response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects a dispatcher for supervisor-only operations', () => {
    const { response, status, json } = responseFor('dispatcher');
    const next = vi.fn();
    requireRole('supervisor')({} as never, response, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ code: 'insufficient_permissions' });
  });
});
