import type { AdminRole } from '@prisma/client';

// What every admin-facing handler knows about the acting administrator.
export type AdminActor = {
  id: string;
  username: string;
  role: AdminRole;
  companyId: string | null;
};

// Error raised when a platform administrator calls a company endpoint without
// choosing which company to act for.
export class CompanyRequiredError extends Error {
  constructor() {
    super('A company must be chosen for this action');
  }
}

export function isPlatformAdmin(admin: Pick<AdminActor, 'role'>) {
  return admin.role === 'platform_admin';
}

// The company whose data the administrator works with. A company
// administrator is always bound to their own company; a platform
// administrator may pick any company or none (then sees everything).
export function actingCompanyId(admin: AdminActor, requested?: string | null): string | null {
  if (isPlatformAdmin(admin)) return requested || null;
  if (!admin.companyId) throw new Error(`Administrator ${admin.id} has no company`);
  return admin.companyId;
}

// Like actingCompanyId, but for actions that create data inside a company.
export function requireCompanyId(admin: AdminActor, requested?: string | null): string {
  const companyId = actingCompanyId(admin, requested);
  if (!companyId) throw new CompanyRequiredError();
  return companyId;
}

// Prisma filters limiting queries to the company's buildings. An empty filter
// means the platform administrator looks across all companies.
export function buildingWhere(companyId: string | null) {
  return companyId ? { companyId } : {};
}

export function viaBuilding(companyId: string | null) {
  return companyId ? { building: { companyId } } : {};
}

export function viaApartment(companyId: string | null) {
  return companyId ? { apartment: { building: { companyId } } } : {};
}
