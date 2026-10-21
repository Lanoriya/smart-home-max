// Requests of the web desk. The session is a cookie; "x-web-desk" lets the
// same session use the API of the mini-app (platform, registry, map), and a
// platform administrator names the company they act for in X-Company-Id.

let actingCompanyId: string | null = null;

export function actAsCompany(companyId: string | null) {
  actingCompanyId = companyId;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code?: string) { super(`API ${status}`); }
}

export async function api<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-web-desk': '1',
      ...(actingCompanyId ? { 'x-company-id': actingCompanyId } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as (T & { code?: string }) | null;
  if (!response.ok) throw new ApiError(response.status, payload?.code);
  return payload as T;
}

export function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
